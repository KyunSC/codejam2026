/**
 * A typed invoice goes through the same checks as a read one.
 *
 * The invoice form has no file and no model, so it never gets the normalised invoice that
 * processInvoice needs and would stay `received` with no flags. Here the typed fields become an
 * `Extracted` (the shape the reader produces), are normalised by the same code, and are committed
 * by the pipeline's own `commit`, which stores them and runs processInvoice in the caller's
 * transaction. Every value a person typed counts as confirmed; a required field left blank stays
 * `missing`, so FIELD_UNCERTAIN still holds it.
 */
import Decimal from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { type Actor, logAction } from "@/lib/audit";
import { AppError } from "@/lib/http";
import { today } from "@/lib/today";
import type { Extracted, IsoDate, Province } from "../types";
import { officeAddress } from "../rules/offices";
import { REQUIRED_FIELDS } from "../pipeline/evidence";
import { normalizeDetailed } from "../pipeline/normalize";
import { commit, type RunOutcome } from "../pipeline/run";

export interface TypedInvoice {
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  poNumber: string | null;
  /** The Harborline office it was delivered to; decides the tax the checks expect. */
  deliveredTo: Province | null;
  subtotal: string | null;
  gstHstAmount: string | null;
  pstQstAmount: string | null;
  total: string;
  lines: Array<{ description: string; quantity: string | null; unitPrice: string | null; amount: string | null }>;
}

/** How close an implied rate must be to a known one to name the tax, e.g. 0.1300 vs 0.13. */
const RATE_TOLERANCE = new Decimal("0.002");

/**
 * The form has one GST/HST box and one PST/QST box. The checks need to know which tax each is, so
 * the label is inferred from the rate the amount implies on the subtotal. When it matches no known
 * rate the label stays ambiguous, normalisation raises TAX_LABEL_UNKNOWN, and a person decides.
 */
export function typedTaxLabel(box: "gstHst" | "pstQst", amount: string, subtotal: string | null): string {
  const known =
    box === "gstHst"
      ? [
          ["0.13", "HST (13%)"],
          ["0.05", "GST (5%)"],
        ]
      : [
          ["0.09975", "QST (9.975%)"],
          ["0.07", "PST (7%)"],
        ];
  const base = subtotal ? new Decimal(subtotal) : null;
  if (base && !base.isZero()) {
    const rate = new Decimal(amount).div(base).abs();
    for (const [r, label] of known) if (rate.minus(r).abs().lte(RATE_TOLERANCE)) return label;
  }
  return box === "gstHst" ? "GST/HST" : "PST/QST";
}

/** The typed fields as the reader would have returned them. */
export function typedExtraction(t: TypedInvoice): Extracted {
  const taxes: Extracted["taxes"] = [];
  const nonZero = (v: string | null): v is string => v !== null && !new Decimal(v).isZero();
  if (nonZero(t.gstHstAmount)) taxes.push({ label: typedTaxLabel("gstHst", t.gstHstAmount, t.subtotal), amount: t.gstHstAmount });
  if (nonZero(t.pstQstAmount)) taxes.push({ label: typedTaxLabel("pstQst", t.pstQstAmount, t.subtotal), amount: t.pstQstAmount });
  return {
    docType: new Decimal(t.total).isNegative() ? "credit_note" : "invoice",
    language: "en",
    vendor: { name: t.vendorName, address: null, gstHstNumber: null, qstNumber: null },
    // The office's full address, which Resolution matches exactly to the province.
    billTo: { name: t.deliveredTo ? "Harborline Logistics Inc." : null, address: t.deliveredTo ? officeAddress(t.deliveredTo) : null },
    invoiceNumber: t.invoiceNumber,
    invoiceDate: t.invoiceDate,
    dueDate: t.dueDate,
    terms: null,
    poNumber: t.poNumber,
    creditNoteRef: null,
    currency: t.currency,
    lines: t.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount })),
    subtotal: t.subtotal,
    taxes,
    total: t.total,
    remit: { institution: null, transit: null, account: null, text: null },
    notes: [],
    unreadable: [],
  };
}

/**
 * Normalises a typed invoice still in `received`, stores it and runs the checks, all in `tx`.
 * Returns the pipeline's outcome (`extracted`, or `needs_review` when a required field is blank).
 */
export async function checkTypedInvoice(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; invoiceId: string; receivedDate: IsoDate; typed: TypedInvoice },
): Promise<RunOutcome> {
  const extracted = typedExtraction(input.typed);
  const result = normalizeDetailed(extracted, {
    fileSha256: `typed:${input.invoiceId}`,
    textLayer: null,
    hasTextLayer: false,
    receivedDate: input.receivedDate,
  });
  // A person typed these: everything present is confirmed, only blanks stay missing.
  const evidence = Object.fromEntries(
    Object.entries(result.invoice.evidence).map(([k, v]) => [k, v === "missing" ? "missing" : "confirmed"] as const),
  );
  const reviewFields = REQUIRED_FIELDS.filter((f) => evidence[f] === "missing").map((field) => ({ field, evidence: "missing" as const }));
  return commit(tx, {
    organizationId: input.organizationId,
    invoiceId: input.invoiceId,
    fileName: null,
    documentId: null,
    inspection: null,
    kind: "invoice",
    extraction: { ok: true, extracted, secondRead: null, source: "typed", model: "typed" },
    result: { ...result, invoice: { ...result.invoice, evidence }, needsReview: reviewFields.length > 0, reviewFields },
  });
}

const str = (d: { toString(): string } | null) => (d === null ? null : d.toString());
const iso = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));

/**
 * Runs the checks on a typed invoice saved before typed invoices were checked: still `received`,
 * from the invoice form, no file. Rebuilds the typed fields from what is stored on it, adds the
 * delivery office the person picks now, and checks it exactly as a new save would. Audited as
 * `invoice.checks_run` by the person who asked, in the same transaction as the checks.
 */
export async function checkStoredTypedInvoice(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; invoiceId: string; actor: Actor; deliveredTo: Province | null },
): Promise<RunOutcome> {
  const inv = await tx.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!inv) throw new AppError(404, "INVOICE_NOT_FOUND", "No such invoice.");
  if (inv.status !== "received") throw new AppError(409, "INVALID_STATE", `This invoice is already ${inv.status}; its checks have run.`);
  if (inv.source !== "manual" || inv.documentId) {
    throw new AppError(409, "NOT_TYPED", "Only an invoice typed into the form can be checked this way; a file is checked when it is read.");
  }
  if (!inv.vendorName || !inv.invoiceNumber || inv.total === null) {
    throw new AppError(422, "INCOMPLETE", "This typed invoice has no vendor, number or total to check. Type it again.");
  }

  await logAction(tx, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: "invoice.checks_run",
    entityType: "invoice",
    entityId: inv.id,
    after: { deliveredTo: input.deliveredTo },
    reason: "Typed before typed invoices were checked; checks run on request.",
  });
  return checkTypedInvoice(tx, {
    organizationId: input.organizationId,
    invoiceId: inv.id,
    receivedDate: iso(inv.receivedDate) ?? today(),
    typed: {
      vendorName: inv.vendorName,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: iso(inv.invoiceDate),
      dueDate: iso(inv.dueDate),
      currency: inv.currency ?? "CAD",
      poNumber: inv.poNumber,
      deliveredTo: input.deliveredTo,
      subtotal: str(inv.subtotal),
      gstHstAmount: str(inv.gstHstAmount),
      pstQstAmount: str(inv.pstQstAmount),
      total: inv.total.toString(),
      lines: inv.lines.map((l) => ({ description: l.description, quantity: str(l.quantity), unitPrice: str(l.unitPrice), amount: str(l.amount) })),
    },
  });
}
