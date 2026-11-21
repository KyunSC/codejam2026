/**
 * processInvoice: the resolve → validate → dedupe → code stages for one stored invoice
 * (BUILD_PLAN Pipeline), written to the database.
 *
 *   normalized (Invoice.normalized) → resolveInvoice → runChecks → Flag rows with evidence
 *   → coding suggestion + reason on each InvoiceLine → status through the transition.
 *
 * Status after processing: `needs_review` while any flag that holds is open, or a line has no
 * account; otherwise `coded` (ready to submit). Route and info flags never block.
 *
 * Re-running is safe: a flag that still fires keeps its row (and its resolution, if a person
 * overrode or confirmed it); an open flag that no longer fires becomes `fixed`; new ones are created.
 * The clerk's final coding (glFinal, departmentFinal) is never overwritten.
 *
 * The rules engine decides everything here; this file only loads, maps and stores.
 */
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor } from "@/lib/audit";
import { AppError } from "@/lib/http";
import { transitionInvoice } from "@/lib/invoices/transition";
import { runChecks } from "@/lib/rules/checks";
import { codingModelFor, suggestAccount } from "@/lib/rules/coding";
import type { Refs } from "@/lib/rules/refs";
import { resolveInvoice } from "@/lib/rules/resolve";
import type { Flag, NormalizedInvoice, ResolvedInvoice } from "@/lib/types";
import { type LiveRefs, loadLiveRefs } from "./refs";

type Tx = Prisma.TransactionClient;

/** States processInvoice may run from. */
export const PROCESSABLE = ["extracted", "needs_review", "coded"] as const;

/** Flag statuses a person set; a re-run keeps them. */
const RESOLVED = new Set(["overridden", "confirmed"]);

const D = (v: unknown): Decimal | null => (v === null || v === undefined || v === "" ? null : new Decimal(v as string));

/** Invoice.normalized as stored (Decimals as strings) back to a NormalizedInvoice. */
export function reviveNormalized(json: unknown): NormalizedInvoice {
  const n = json as Record<string, unknown> & NormalizedInvoice;
  const terms = n.terms as (NormalizedInvoice["terms"] & { discountPct: unknown }) | null;
  return {
    ...n,
    subtotal: D(n.subtotal),
    total: D(n.total),
    terms: terms ? { ...terms, discountPct: D(terms.discountPct) } : null,
    lines: (n.lines ?? []).map((l) => ({ ...l, quantity: D(l.quantity), unitPrice: D(l.unitPrice), amount: D(l.amount) })),
    taxes: (n.taxes ?? []).map((t) => ({ ...t, ratePrinted: D(t.ratePrinted), amount: D(t.amount) ?? new Decimal(0) })),
    evidence: n.evidence ?? {},
    parseIssues: n.parseIssues ?? [],
    notes: n.notes ?? [],
  };
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
const str = (d: Decimal | null | undefined) => (d ? d.toString() : null);

/** Values a person chose in review, kept in Invoice.normalized.clerk so a re-run respects them. */
export interface ClerkChoices {
  vendorId?: string;
  departmentId?: string;
  requesterId?: string;
  shipToProvince?: ResolvedInvoice["shipToProvince"];
  poId?: string;
}

export function clerkChoices(normalized: unknown): ClerkChoices {
  const c = (normalized as { clerk?: ClerkChoices } | null)?.clerk;
  return c && typeof c === "object" ? c : {};
}

/**
 * Applies the clerk's choices over what resolution found. A chosen vendor brings its contract and
 * its coding; a chosen PO brings its department when none was chosen.
 */
export function applyClerkChoices(inv: ResolvedInvoice, c: ClerkChoices, refs: Refs): ResolvedInvoice {
  let out = inv;
  if (c.vendorId && c.vendorId !== inv.vendorId && refs.vendors.has(c.vendorId)) {
    const vendor = refs.vendors.get(c.vendorId)!;
    const model = codingModelFor(refs);
    out = {
      ...out,
      vendorId: c.vendorId,
      vendorMatchedBy: null,
      vendorCandidates: [],
      contractId: refs.contractByVendor.get(c.vendorId)?.contractId ?? null,
      lines: out.lines.map((l) => ({ ...l, glAccount: suggestAccount(l.description, vendor, model, refs).glAccount })),
    };
  }
  if (c.poId && refs.purchaseOrders.has(c.poId)) {
    const po = refs.purchaseOrders.get(c.poId)!;
    out = { ...out, poId: c.poId, poNumber: out.poNumber ?? c.poId, poSuggestions: [], departmentId: po.departmentId, requesterId: out.requesterId ?? po.requesterUserId };
  }
  if (c.departmentId) out = { ...out, departmentId: c.departmentId };
  if (c.requesterId) out = { ...out, requesterId: c.requesterId };
  if (c.shipToProvince) out = { ...out, shipToProvince: c.shipToProvince };
  return out;
}

/**
 * Resolution for a stored invoice: its normalized values through resolveInvoice, with the clerk's
 * choices on top. The uploader counts as requester when they are an employee.
 */
export function resolveStored(
  row: { normalized: unknown; createdBy?: { role: string; externalId: string | null; id: string } | null },
  refs: Refs,
) {
  const doc = reviveNormalized(row.normalized);
  const uploaderId =
    row.createdBy && row.createdBy.role === "employee" ? (row.createdBy.externalId ?? row.createdBy.id) : null;
  const base = resolveInvoice(doc, refs, { uploaderId });
  const clerk = clerkChoices(row.normalized);
  const resolved = applyClerkChoices(base.invoice, clerk, refs);
  const notes = {
    ...base.notes,
    ...(clerk.vendorId ? { vendor: `Chosen by the AP clerk: ${clerk.vendorId}.` } : {}),
    ...(clerk.departmentId ? { department: `Chosen by the AP clerk: ${clerk.departmentId}.` } : {}),
  };
  return { resolved, notes };
}

/** Whether the flags and lines leave the invoice needing a person. */
export function needsReview(openFlags: readonly Pick<Flag, "effect">[], lines: readonly { glAccount: string | null }[]): boolean {
  return openFlags.some((f) => f.effect === "hold") || lines.some((l) => !l.glAccount);
}

export interface ProcessResult {
  invoiceId: string;
  status: "needs_review" | "coded";
  flags: Flag[];
  resolved: ResolvedInvoice;
  version: number;
}

export interface ProcessInput {
  organizationId: string;
  invoiceId: string;
  actor: Actor;
  /** Refs to use; default loaded from the database as of this invoice. */
  refs?: Refs;
}

export async function processInvoice(tx: Tx, input: ProcessInput): Promise<ProcessResult> {
  const { organizationId, invoiceId, actor } = input;
  const row = await tx.invoice.findFirst({
    where: { organizationId, id: invoiceId },
    include: { lines: { orderBy: { lineNo: "asc" } }, flags: true, createdBy: { select: { role: true, externalId: true, id: true } } },
  });
  if (!row) throw new AppError(404, "INVOICE_NOT_FOUND", `No invoice ${invoiceId}.`);
  if (!(PROCESSABLE as readonly string[]).includes(row.status)) {
    throw new AppError(409, "INVALID_STATE", `Invoice ${invoiceId} is ${row.status}; only extracted, needs_review or coded invoices are checked.`);
  }
  if (!row.normalized) {
    throw new AppError(409, "NOT_EXTRACTED", `Invoice ${invoiceId} has no extracted values to check.`);
  }

  const refs =
    input.refs ??
    (await loadLiveRefs(tx, organizationId, { self: { invoiceId, receivedDate: row.receivedDate, status: row.status } }));
  const { resolved, notes } = resolveStored(row, refs);
  const flags = runChecks(resolved, refs);

  // ---- Flags: keep, refresh, fix, create ----
  const existing = row.flags.filter((f) => !f.paymentId && !f.bankTxnId);
  const firing = new Set(flags.map((f) => f.code));
  for (const f of existing) {
    if (f.status === "open" && !firing.has(f.code as Flag["code"]) && f.code !== "UNREADABLE") {
      await tx.flag.update({
        where: { id: f.id },
        data: { status: "fixed", resolvedAt: new Date(), resolutionNote: "No longer fires after the checks re-ran." },
      });
    }
  }
  const byCode = new Map(existing.map((f) => [f.code, f]));
  for (const f of flags) {
    const prior = byCode.get(f.code);
    const data = {
      klass: f.klass,
      effect: f.effect,
      message: f.message,
      evidence: json(f.evidence),
      related: f.related ? json(f.related) : undefined,
      vendorId: resolved.vendorId,
    };
    if (prior && RESOLVED.has(prior.status)) continue;
    if (prior) await tx.flag.update({ where: { id: prior.id }, data: { ...data, status: "open", resolvedAt: null, resolutionNote: null } });
    else await tx.flag.create({ data: { ...data, organizationId, invoiceId, code: f.code } });
  }

  // ---- Lines: suggested coding and reason ----
  const model = codingModelFor(refs);
  const vendor = resolved.vendorId ? refs.vendors.get(resolved.vendorId) : undefined;
  for (const l of resolved.lines) {
    const s = suggestAccount(l.description, vendor, model, refs);
    const data = {
      glSuggested: l.glAccount,
      departmentSuggested: resolved.departmentId,
      lineType: l.lineType,
      reason: json({
        account: s.reason,
        accountSource: s.source,
        department: notes.department,
        lineType: l.lineTypeSource,
      }),
    };
    const stored = row.lines.find((x) => x.lineNo === l.lineNo);
    if (stored) await tx.invoiceLine.update({ where: { id: stored.id }, data });
    else
      await tx.invoiceLine.create({
        data: { ...data, invoiceId, lineNo: l.lineNo, description: l.description, quantity: str(l.quantity), unitPrice: str(l.unitPrice), amount: str(l.amount) },
      });
  }

  // ---- Status ----
  const stillOpen = (await tx.flag.findMany({ where: { invoiceId, status: "open" }, select: { effect: true } })) as Pick<Flag, "effect">[];
  const lineAccounts = resolved.lines.map((l) => {
    const stored = row.lines.find((x) => x.lineNo === l.lineNo);
    return { glAccount: stored?.glFinal ?? l.glAccount };
  });
  const status = needsReview(stillOpen, lineAccounts) ? "needs_review" : "coded";

  const t = await transitionInvoice(tx, {
    organizationId,
    invoiceId,
    to: status,
    actor,
    action: "invoice.checked",
    data: {
      vendorId: resolved.vendorId,
      shipToProvince: resolved.shipToProvince,
      poId: resolved.poId,
      contractId: resolved.contractId,
      departmentId: resolved.departmentId,
      requesterId: (refs as Partial<LiveRefs>).people?.toRow(resolved.requesterId) ?? row.requesterId,
      creditOfInvoiceId: resolved.creditOfInvoiceId,
      currency: resolved.currencyResolved ?? row.currency,
      fxRateToCad: str(resolved.fxRateToCad),
      totalCad: str(resolved.totalCad),
    },
    auditAfter: {
      vendorId: resolved.vendorId,
      vendorMatchedBy: resolved.vendorMatchedBy,
      vendorReason: notes.vendor,
      departmentId: resolved.departmentId,
      flags: flags.map((f) => `${f.code} (${f.klass}/${f.effect})`),
    },
  });

  return { invoiceId, status, flags, resolved, version: t.version };
}
