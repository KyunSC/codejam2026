/**
 * Review actions on one invoice (BUILD_PLAN Server API):
 *
 * - resolveFlag: POST /invoices/:id/flags/:flagId/resolve { action, reason }
 *     data / policy flags: AP clerk; fraud flags: finance manager or controller (else 403 FLAG_CLASS).
 *     A reason is always required (422 REASON_REQUIRED).
 *     action "override": accepted with the reason. An overridden policy or fraud flag adds a finance
 *       manager step when the invoice is routed.
 *     action "confirm" (fraud only): the problem is real. A confirmed duplicate sets the invoice to
 *       `duplicate`; any other confirmed fraud flag stays and keeps holding payment.
 * - patchInvoice: PATCH /invoices/:id with If-Match: version (AP clerk)
 *     printed fields the clerk corrects, the clerk's choices (vendor, department, province, requester,
 *     PO), and per-line coding (accept the suggestion or set another account / department).
 *     Each change is audited with both values; the checks then re-run.
 *
 * Both re-run processInvoice when the invoice is still in review, so the status follows the flags.
 */
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { logAction } from "@/lib/audit";
import { authorize, checkNotReadOnly, firstFailure } from "@/lib/auth/matrix";
import { AppError } from "@/lib/http";
import { bumpInvoiceVersion, transitionInvoice } from "@/lib/invoices/transition";
import { digitsKey, numberKey } from "@/lib/rules/keys";
import { enforce, type WorkflowActor } from "./guard";
import { type ClerkChoices, clerkChoices, PROCESSABLE, processInvoice } from "./process";

type Tx = Prisma.TransactionClient;

const DUP_CODES = new Set(["DUP_EXACT", "DUP_NEAR", "DUP_CONTENT", "DUP_PAID_BY_CARD"]);
const PROVINCES = new Set(["ON", "BC", "AB", "QC"]);

const inReview = (status: string) => (PROCESSABLE as readonly string[]).includes(status);

export interface ResolveFlagInput {
  organizationId: string;
  invoiceId: string;
  flagId: string;
  action: string;
  reason: string | null | undefined;
}

export async function resolveFlag(tx: Tx, actor: WorkflowActor, input: ResolveFlagInput) {
  const flag = await tx.flag.findFirst({
    where: { organizationId: input.organizationId, id: input.flagId, invoiceId: input.invoiceId },
  });
  if (!flag) throw new AppError(404, "FLAG_NOT_FOUND", "No such flag on this invoice.");
  const action = flag.klass === "fraud" ? "flag.resolve.fraud" : "flag.resolve.data_policy";
  const d = firstFailure(authorize(actor.matrix, action), checkNotReadOnly(actor.matrix));
  if (!d.ok) {
    if (d.code === "READ_ONLY_ROLE") enforce(d);
    throw new AppError(
      403,
      "FLAG_CLASS",
      flag.klass === "fraud"
        ? "Only a finance manager or controller may resolve a fraud flag."
        : "Only an AP clerk resolves data and policy flags.",
    );
  }
  if (input.action !== "override" && input.action !== "confirm") {
    throw new AppError(422, "BAD_ACTION", 'action must be "override" or "confirm".');
  }
  if (input.action === "confirm" && flag.klass !== "fraud") {
    throw new AppError(422, "BAD_ACTION", "Only a fraud flag can be confirmed; fix the field or override with a reason.");
  }
  const reason = input.reason?.trim();
  if (!reason) throw new AppError(422, "REASON_REQUIRED", "Say why, in a sentence.");
  if (flag.status !== "open") throw new AppError(409, "INVALID_STATE", `This flag is already ${flag.status}.`);

  const status = input.action === "override" ? "overridden" : "confirmed";
  const updated = await tx.flag.update({
    where: { id: flag.id },
    data: { status, resolvedById: actor.matrix.userId, resolvedAt: new Date(), resolutionNote: reason },
  });
  await logAction(tx, {
    organizationId: input.organizationId,
    actor: actor.audit,
    action: `flag.${input.action}`,
    entityType: "flag",
    entityId: flag.id,
    invoiceId: input.invoiceId,
    vendorId: flag.vendorId,
    before: { code: flag.code, status: flag.status },
    after: { code: flag.code, status, klass: flag.klass, effect: flag.effect },
    reason,
  });

  const invoice = await tx.invoice.findFirstOrThrow({
    where: { organizationId: input.organizationId, id: input.invoiceId },
    select: { status: true },
  });
  if (status === "confirmed" && DUP_CODES.has(flag.code) && invoice.status !== "duplicate") {
    await transitionInvoice(tx, {
      organizationId: input.organizationId,
      invoiceId: input.invoiceId,
      to: "duplicate",
      actor: actor.audit,
      action: "invoice.duplicate",
      reason,
    });
  } else if (inReview(invoice.status)) {
    await processInvoice(tx, { organizationId: input.organizationId, invoiceId: input.invoiceId, actor: actor.audit });
  }
  return updated;
}

// ---------- PATCH ----------

export interface LinePatch {
  lineNo: number;
  /** Take the suggested account (and department) as final. */
  accept?: boolean;
  glFinal?: string | null;
  departmentFinal?: string | null;
}

export interface InvoicePatch {
  fields?: Partial<Record<"invoiceNumber" | "invoiceDate" | "dueDate" | "total" | "subtotal" | "poNumber", string | null>>;
  choices?: ClerkChoices;
  lines?: LinePatch[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function moneyOrNull(v: string | null, field: string): Decimal | null {
  if (v === null || v === "") return null;
  try {
    return new Decimal(v.replace(/[$,\s]/g, ""));
  } catch {
    throw new AppError(422, "BAD_FIELD", `${field}: must be a number.`);
  }
}

export async function patchInvoice(
  tx: Tx,
  actor: WorkflowActor,
  organizationId: string,
  invoiceId: string,
  ifMatch: number | null,
  patch: InvoicePatch,
) {
  if (ifMatch === null || !Number.isInteger(ifMatch)) {
    throw new AppError(428, "VERSION_REQUIRED", "Send the version you edited as the If-Match header.");
  }
  const row = await tx.invoice.findFirst({ where: { organizationId, id: invoiceId }, include: { lines: true } });
  if (!row) throw new AppError(404, "INVOICE_NOT_FOUND", `No invoice ${invoiceId}.`);
  if (row.version !== ifMatch) {
    throw new AppError(409, "VERSION_CONFLICT", `Invoice ${invoiceId} changed since you opened it. Reload and try again.`);
  }
  if (!inReview(row.status)) {
    throw new AppError(409, "INVALID_STATE", `Invoice ${invoiceId} is ${row.status}; fields and coding change only in review.`);
  }

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const columns: Prisma.InvoiceUncheckedUpdateManyInput = {};
  const normalized = { ...((row.normalized ?? {}) as Record<string, unknown>) };
  const evidence = { ...((normalized.evidence ?? {}) as Record<string, string>) };

  // Printed fields the clerk corrects: stored on the row and in `normalized`, marked confirmed by a person.
  for (const [field, raw] of Object.entries(patch.fields ?? {})) {
    const value = raw === null ? null : String(raw).trim();
    before[field] = normalized[field] ?? null;
    if (field === "invoiceDate" || field === "dueDate") {
      if (value && !DATE.test(value)) throw new AppError(422, "BAD_FIELD", `${field}: write it YYYY-MM-DD.`);
      normalized[field] = value;
      columns[field] = value ? new Date(`${value}T00:00:00Z`) : null;
    } else if (field === "total" || field === "subtotal") {
      const d = moneyOrNull(value, field);
      normalized[field] = d?.toString() ?? null;
      columns[field] = d?.toString() ?? null;
    } else if (field === "invoiceNumber") {
      normalized.invoiceNumber = value;
      normalized.numberKey = numberKey(value);
      normalized.digitsKey = digitsKey(value);
      Object.assign(columns, { invoiceNumber: value, numberKey: numberKey(value), digitsKey: digitsKey(value) });
    } else if (field === "poNumber") {
      normalized.poNumber = value;
      columns.poNumber = value;
    } else {
      throw new AppError(422, "BAD_FIELD", `${field}: not an editable field.`);
    }
    evidence[field] = "confirmed";
    after[field] = normalized[field];
  }

  // Choices: vendor, department, province, requester, PO.
  if (patch.choices) {
    const c = { ...clerkChoices(row.normalized) };
    for (const [k, v] of Object.entries(patch.choices) as Array<[keyof ClerkChoices, string | undefined]>) {
      if (!v) {
        delete c[k];
        continue;
      }
      if (k === "vendorId" && !(await tx.vendor.findFirst({ where: { organizationId, id: v } }))) {
        throw new AppError(422, "BAD_FIELD", `vendorId: no vendor ${v}.`);
      }
      if (k === "departmentId" && !(await tx.department.findFirst({ where: { organizationId, id: v } }))) {
        throw new AppError(422, "BAD_FIELD", `departmentId: no department ${v}.`);
      }
      if (k === "poId" && !(await tx.purchaseOrder.findFirst({ where: { organizationId, id: v } }))) {
        throw new AppError(422, "BAD_FIELD", `poId: no purchase order ${v}.`);
      }
      if (k === "shipToProvince" && !PROVINCES.has(v)) throw new AppError(422, "BAD_FIELD", "shipToProvince: ON, BC, AB or QC.");
      before[`choice.${k}`] = (row as Record<string, unknown>)[k] ?? null;
      (c as Record<string, string>)[k] = v;
      after[`choice.${k}`] = v;
    }
    normalized.clerk = c;
  }
  normalized.evidence = evidence;

  // Coding, line by line: both values audited.
  for (const lp of patch.lines ?? []) {
    const line = row.lines.find((l) => l.lineNo === lp.lineNo);
    if (!line) throw new AppError(422, "BAD_FIELD", `lines: no line ${lp.lineNo}.`);
    const glFinal = lp.accept ? line.glSuggested : lp.glFinal !== undefined ? lp.glFinal : line.glFinal;
    const departmentFinal = lp.accept
      ? (line.departmentFinal ?? line.departmentSuggested)
      : lp.departmentFinal !== undefined
        ? lp.departmentFinal
        : line.departmentFinal;
    if (glFinal && !(await tx.glAccount.findFirst({ where: { organizationId, id: glFinal } }))) {
      throw new AppError(422, "BAD_FIELD", `lines[${lp.lineNo}].glFinal: no GL account ${glFinal}.`);
    }
    if (departmentFinal && !(await tx.department.findFirst({ where: { organizationId, id: departmentFinal } }))) {
      throw new AppError(422, "BAD_FIELD", `lines[${lp.lineNo}].departmentFinal: no department ${departmentFinal}.`);
    }
    await tx.invoiceLine.update({ where: { id: line.id }, data: { glFinal, departmentFinal } });
    before[`line.${lp.lineNo}`] = { glSuggested: line.glSuggested, glFinal: line.glFinal, departmentFinal: line.departmentFinal };
    after[`line.${lp.lineNo}`] = { glFinal, departmentFinal, accepted: !!lp.accept };
  }

  await bumpInvoiceVersion(tx, organizationId, invoiceId, ifMatch, {
    ...columns,
    normalized: normalized as Prisma.InputJsonValue,
  });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: "invoice.edit",
    entityType: "invoice",
    entityId: invoiceId,
    before,
    after,
  });
  const r = row.normalized
    ? await processInvoice(tx, { organizationId, invoiceId, actor: actor.audit })
    : null;
  const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, version: true } });
  return { invoiceId, status: fresh.status, version: fresh.version, flags: r?.flags ?? [] };
}
