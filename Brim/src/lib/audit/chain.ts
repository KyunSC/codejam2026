/**
 * Hash chain for the append-only audit log (BUILD_PLAN "Audit trail").
 *
 * Each row stores `prevHash` (the previous row's hash) and
 * `hash = sha256(prevHash + canonicalJson(row))`, where the row is every field except
 * `seq`, `prevHash` and `hash`. Changing a stored field breaks that row's hash; deleting or
 * reordering a row breaks the next row's `prevHash`. `verifyChain` reports the first row
 * that does not match.
 *
 * `seq` is left out on purpose: the database assigns it, and a rolled-back transaction can
 * skip a number, so the writer cannot know it before the insert. Order comes from `seq`;
 * integrity comes from the links.
 *
 * Pure: no database, so the seed, the writer and the "verify chain" action share it.
 */
import { createHash } from "node:crypto";

/** prevHash of the first row. */
export const GENESIS_HASH = "0".repeat(64);

/** The fields that are hashed. Mirrors the AuditEvent model minus seq, prevHash and hash. */
export interface AuditFields {
  at: Date;
  actorId: string | null;
  actorRole: string | null;
  onBehalfOfId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  invoiceId: string | null;
  paymentId: string | null;
  vendorId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  source: "app" | "history";
}

export interface ChainedAuditRow extends AuditFields {
  seq?: bigint | number;
  prevHash: string;
  hash: string;
}

/**
 * JSON with object keys sorted at every depth, so the same data always gives the same text.
 * Dates become ISO strings, bigints become decimal strings, objects with a `toJSON` (Decimal)
 * use it, and `undefined` object values are dropped (as JSON.stringify does).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Cannot hash an invalid Date");
    return value.toISOString();
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Cannot hash a non-finite number: ${value}`);
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object") {
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === "function") return normalise(withToJson.toJSON());
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalise(v);
    }
    return out;
  }
  return value;
}

function hashedPart(row: AuditFields): AuditFields {
  return {
    at: row.at,
    actorId: row.actorId,
    actorRole: row.actorRole,
    onBehalfOfId: row.onBehalfOfId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    invoiceId: row.invoiceId,
    paymentId: row.paymentId,
    vendorId: row.vendorId,
    before: row.before ?? null,
    after: row.after ?? null,
    reason: row.reason,
    source: row.source,
  };
}

export function auditHash(prevHash: string, row: AuditFields): string {
  return createHash("sha256").update(prevHash).update(canonicalJson(hashedPart(row))).digest("hex");
}

/** Links rows in order, starting after `prevHash` (the current last row's hash, or genesis). */
export function chainRows<T extends AuditFields>(
  rows: ReadonlyArray<T>,
  prevHash: string = GENESIS_HASH,
): Array<T & { prevHash: string; hash: string }> {
  let prev = prevHash;
  return rows.map((row) => {
    const hash = auditHash(prev, row);
    const linked = { ...row, prevHash: prev, hash };
    prev = hash;
    return linked;
  });
}

export type ChainResult =
  | { ok: true; count: number; lastHash: string }
  | { ok: false; count: number; index: number; seq: string | null; reason: string };

/** Recomputes every hash in order (rows sorted by seq) and reports the first that does not match. */
export function verifyChain(rows: ReadonlyArray<Omit<ChainedAuditRow, "prevHash" | "hash"> & { prevHash: string | null; hash: string | null }>, startHash: string = GENESIS_HASH): ChainResult {
  let prev = startHash;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const seq = row.seq === undefined ? null : String(row.seq);
    if (row.prevHash !== prev) {
      return {
        ok: false,
        count: rows.length,
        index: i,
        seq,
        reason: `Row ${seq ?? i} points at ${row.prevHash?.slice(0, 12)}… but the row before it hashes to ${prev.slice(0, 12)}…: a row was removed, inserted or reordered.`,
      };
    }
    const expected = auditHash(prev, row);
    if (row.hash !== expected) {
      return {
        ok: false,
        count: rows.length,
        index: i,
        seq,
        reason: `Row ${seq ?? i} stores hash ${row.hash?.slice(0, 12)}… but its contents hash to ${expected.slice(0, 12)}…: the row was changed after it was written.`,
      };
    }
    prev = row.hash;
  }
  return { ok: true, count: rows.length, lastHash: prev };
}
