/**
 * The audit log. Every part of the app that changes data records it here.
 *
 *   await db().$transaction(async (tx) => {
 *     const user = await tx.user.update(...);
 *     await logAction(tx, { organizationId, actor, action: "user.updated", entityType: "user",
 *                           entityId: user.id, before, after: user });
 *   });
 *
 * `logAction` takes the transaction client, not the shared client, so the log row commits or
 * rolls back with the change it describes. There is no function to edit or delete a row.
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { auditHash, GENESIS_HASH } from "./audit/chain";
import { db } from "./db";

/** Who acted. A delegate acting for someone on leave passes that person as onBehalfOfId. */
export type Actor =
  | { type: "user"; userId: string; onBehalfOfId?: string; role?: string }
  | { type: "llm"; model: string }
  | { type: "system" }
  | { type: "brim_admin"; staffId?: string };

export interface ActionInput {
  organizationId: string;
  actor: Actor;
  /** Dotted name: "<entity>.<what happened>", e.g. "invoice.received", "user.updated". */
  action: string;
  entityType: string;
  entityId: string;
  /** Set whenever the action concerns an invoice. Filled in from entityId for entityType "invoice". */
  invoiceId?: string | null;
  paymentId?: string | null;
  vendorId?: string | null;
  /** State before and after. Pass plain objects; Decimal, Date and BigInt are converted. */
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/** Field names never written to the log, whatever object they appear in. */
const SECRET_KEYS = new Set(["passwordHash", "password"]);

/** Turns Decimal, Date and BigInt into strings, and drops file bytes and secrets, so the value stores as JSON. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (SECRET_KEYS.has(k)) return undefined;
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
      if (v && typeof v === "object" && v.type === "Buffer" && Array.isArray(v.data)) return `<${v.data.length} bytes>`;
      return v;
    }),
  );
}

/**
 * One group id per transaction: every row a single action writes (it runs in one `$transaction`)
 * shares it, so the log can show them as one entry. Keyed weakly on the transaction client, which is
 * one object for the life of the transaction. A plain client (no transaction) gets no group.
 */
const groupOfTx = new WeakMap<object, string>();

export function actionGroupFor(tx: object): string | null {
  // A full client has $connect; a transaction client doesn't ($transaction alone can't tell them
  // apart: Prisma 7 gives the transaction client one too).
  if (typeof (tx as { $connect?: unknown }).$connect === "function") return null;
  let id = groupOfTx.get(tx);
  if (!id) {
    id = randomUUID();
    groupOfTx.set(tx, id);
  }
  return id;
}

/**
 * Appends one row and links it into the organization's hash chain (src/lib/audit/chain.ts).
 * A transaction-scoped advisory lock per organization serialises writers, so two concurrent
 * transactions cannot both link to the same previous row. The action group id is not hashed.
 */
export async function logAction(tx: Prisma.TransactionClient, input: ActionInput) {
  const { actor } = input;
  const organizationId = input.organizationId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + organizationId}))`;
  const last = await tx.auditEvent.findFirst({
    where: { organizationId, hash: { not: null } },
    orderBy: { seq: "desc" },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? GENESIS_HASH;

  let actorRole: string | null = null;
  if (actor.type === "user") {
    actorRole =
      actor.role ??
      (await tx.user.findUnique({ where: { id: actor.userId }, select: { role: true } }))?.role ??
      null;
  } else {
    actorRole = actor.type;
  }

  const fields = {
    at: new Date(),
    actorId:
      actor.type === "user"
        ? actor.userId
        : actor.type === "llm"
          ? actor.model
          : actor.type === "brim_admin"
            ? (actor.staffId ?? null)
            : null,
    actorRole,
    onBehalfOfId: actor.type === "user" ? (actor.onBehalfOfId ?? null) : null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    invoiceId: input.invoiceId ?? (input.entityType === "invoice" ? input.entityId : null),
    paymentId: input.paymentId ?? (input.entityType === "payment" ? input.entityId : null),
    vendorId: input.vendorId ?? (input.entityType === "vendor" ? input.entityId : null),
    before: toJson(input.before) ?? null,
    after: toJson(input.after) ?? null,
    reason: input.reason ?? null,
    source: "app" as const,
  };
  const hash = auditHash(prevHash, fields);
  return tx.auditEvent.create({
    data: {
      ...fields,
      actionGroupId: actionGroupFor(tx),
      organizationId,
      actorType: actor.type,
      before: fields.before ?? undefined,
      after: fields.after ?? undefined,
      prevHash,
      hash,
    },
  });
}

export interface AuditFilter {
  invoiceId?: string;
  paymentId?: string;
  vendorId?: string;
  actorId?: string;
  actorType?: Actor["type"];
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Free text: matches the action name, the record id, the invoice id or the reason. */
  q?: string;
  /** ISO timestamps, inclusive. */
  from?: string;
  to?: string;
  /** Newest first; default 100, at most 1000. */
  limit?: number;
  /** Return rows with seq below this, for the next page. */
  beforeSeq?: bigint;
}

/** Every row of the given action groups, whatever filters the page used. */
export async function listGroupRows(organizationId: string, groupIds: readonly string[]) {
  if (groupIds.length === 0) return [];
  return db().auditEvent.findMany({
    where: { organizationId, actionGroupId: { in: [...new Set(groupIds)] } },
    orderBy: { seq: "desc" },
  });
}

/** One organization's log, newest first, narrowed by any of the filters. */
export async function listActions(organizationId: string, f: AuditFilter = {}) {
  const at: Prisma.DateTimeFilter = {};
  if (f.from) at.gte = new Date(f.from);
  if (f.to) at.lte = new Date(f.to);
  return db().auditEvent.findMany({
    where: {
      organizationId,
      invoiceId: f.invoiceId,
      paymentId: f.paymentId,
      vendorId: f.vendorId,
      actorId: f.actorId,
      actorType: f.actorType,
      action: f.action,
      entityType: f.entityType,
      entityId: f.entityId,
      at: f.from || f.to ? at : undefined,
      seq: f.beforeSeq ? { lt: f.beforeSeq } : undefined,
      OR: f.q?.trim()
        ? [
            { action: { contains: f.q.trim(), mode: "insensitive" } },
            { entityId: f.q.trim() },
            { invoiceId: f.q.trim() },
            { reason: { contains: f.q.trim(), mode: "insensitive" } },
          ]
        : undefined,
    },
    orderBy: { seq: "desc" },
    take: Math.min(Math.max(f.limit ?? 100, 1), 1000),
  });
}
