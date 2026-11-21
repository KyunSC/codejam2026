/**
 * Fraud watch (BUILD_PLAN Bonus → Fraud alerts): every open fraud flag across invoices, vendors and
 * payments, with the amount at stake. Finance manager and controller (the roles that resolve fraud flags).
 * Read-only; an open fraud flag already blocks prepare and release (payments.ts paymentBlockers).
 *
 * Amount at stake, in CAD:
 * - a flag on an invoice: the invoice's total, unless it is already settled (paid, rejected, duplicate, void);
 * - a flag on a vendor alone: every unsettled invoice of that vendor;
 * - a flag on a payment: the payment, unless it has been sent.
 * The page total counts each invoice once.
 */
import Decimal from "decimal.js";
import type { User } from "@/generated/prisma/client";
import { authorize } from "@/lib/auth/matrix";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { enforce, workflowActor } from "./guard";

const SETTLED = new Set(["paid", "rejected", "duplicate", "void"]);
const SENT = new Set(["sent", "settled"]);
export const SENDER_CODES = new Set(["SENDER_DOMAIN_MISMATCH", "SENDER_LOOKALIKE_DOMAIN"]);

export interface FraudRow {
  flagId: string;
  code: string;
  message: string;
  evidence: Array<{ label: string; value: string; source: string }>;
  scope: "invoice" | "vendor" | "payment";
  createdAt: Date;
  invoice: { id: string; status: string; invoiceNumber: string | null; total: string | null; currency: string | null; dueDate: Date | null } | null;
  vendor: { id: string; legalName: string; status: string } | null;
  payments: Array<{ id: string; status: string; amount: string; currency: string }>;
  atStakeCad: string;
  atStakeNote: string;
  /** Invoice ids the amount at stake covers (for the de-duplicated total). */
  stakeInvoiceIds: string[];
}

const cad = (inv: { totalCad: { toString(): string } | null; total: { toString(): string } | null; currency: string | null }) =>
  new Decimal((inv.totalCad ?? (inv.currency === "CAD" || !inv.currency ? inv.total : null) ?? 0).toString());

export async function fraudWatch(user: User | null) {
  if (!user) throw new AppError(403, "FORBIDDEN", "Log in as a person at this organization.");
  enforce(authorize(workflowActor(user).matrix, "flag.resolve.fraud"));
  const organizationId = user.organizationId;
  const prisma = db();

  const flags = await prisma.flag.findMany({ where: { organizationId, klass: "fraud", status: "open" }, orderBy: { createdAt: "asc" } });
  const paymentIds = flags.map((f) => f.paymentId).filter((x): x is string => !!x);
  const flaggedPayments = paymentIds.length ? await prisma.payment.findMany({ where: { organizationId, id: { in: paymentIds } } }) : [];
  const invoiceIds = [...new Set([...flags.map((f) => f.invoiceId), ...flaggedPayments.map((p) => p.invoiceId)].filter((x): x is string => !!x))];
  const vendorOnly = [...new Set(flags.filter((f) => !f.invoiceId && !f.paymentId && f.vendorId).map((f) => f.vendorId!))];

  const invoiceSelect = { id: true, status: true, invoiceNumber: true, total: true, totalCad: true, currency: true, dueDate: true, vendorId: true } as const;
  const [invoices, vendorInvoices] = await Promise.all([
    prisma.invoice.findMany({ where: { organizationId, id: { in: invoiceIds } }, select: invoiceSelect }),
    vendorOnly.length
      ? prisma.invoice.findMany({ where: { organizationId, vendorId: { in: vendorOnly }, status: { notIn: [...SETTLED] } }, select: invoiceSelect })
      : Promise.resolve([]),
  ]);
  const vendorIds = [...new Set([...flags.map((f) => f.vendorId), ...invoices.map((i) => i.vendorId)].filter((x): x is string => !!x))];
  const [vendors, payments] = await Promise.all([
    prisma.vendor.findMany({ where: { organizationId, id: { in: vendorIds } }, select: { id: true, legalName: true, status: true } }),
    prisma.payment.findMany({ where: { organizationId, invoiceId: { in: invoiceIds } }, orderBy: { id: "asc" } }),
  ]);
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const rows: FraudRow[] = flags.map((f) => {
    const payment = f.paymentId ? flaggedPayments.find((p) => p.id === f.paymentId) : undefined;
    const inv = invoiceById.get(f.invoiceId ?? payment?.invoiceId ?? "");
    const vendor = vendorById.get(f.vendorId ?? inv?.vendorId ?? "") ?? null;
    const scope: FraudRow["scope"] = f.paymentId ? "payment" : f.invoiceId ? "invoice" : "vendor";
    let stake = new Decimal(0);
    let note: string;
    let stakeInvoiceIds: string[] = [];
    if (scope === "payment" && payment) {
      if (SENT.has(payment.status)) note = `payment ${payment.id} already ${payment.status}`;
      else {
        stake = new Decimal(payment.amountCad.toString());
        note = `payment ${payment.id}, ${payment.status}`;
        stakeInvoiceIds = [payment.invoiceId];
      }
    } else if (scope === "invoice" && inv) {
      if (SETTLED.has(inv.status)) note = `invoice already ${inv.status}`;
      else {
        stake = cad(inv);
        note = inv.currency && inv.currency !== "CAD" ? `${inv.currency} ${inv.total?.toString()} at the invoice-date rate` : "invoice total";
        stakeInvoiceIds = [inv.id];
      }
    } else {
      const open = vendorInvoices.filter((i) => i.vendorId === f.vendorId);
      stake = open.reduce((s, i) => s.plus(cad(i)), new Decimal(0));
      note = `${open.length} unsettled invoice${open.length === 1 ? "" : "s"} of this vendor`;
      stakeInvoiceIds = open.map((i) => i.id);
    }
    return {
      flagId: f.id,
      code: f.code,
      message: f.message,
      evidence: (f.evidence as FraudRow["evidence"]) ?? [],
      scope,
      createdAt: f.createdAt,
      invoice: inv
        ? { id: inv.id, status: inv.status, invoiceNumber: inv.invoiceNumber, total: inv.total?.toString() ?? null, currency: inv.currency, dueDate: inv.dueDate }
        : null,
      vendor,
      payments: payments
        .filter((p) => p.invoiceId === inv?.id)
        .map((p) => ({ id: p.id, status: p.status, amount: p.amount.toString(), currency: p.currency })),
      atStakeCad: stake.toFixed(2),
      atStakeNote: note,
      stakeInvoiceIds,
    };
  });
  rows.sort((a, b) => new Decimal(b.atStakeCad).cmp(a.atStakeCad) || a.code.localeCompare(b.code));

  // Total at stake: each invoice once, at its largest stake on the page.
  const perInvoice = new Map<string, Decimal>();
  for (const r of rows) {
    if (r.scope === "vendor") {
      for (const id of r.stakeInvoiceIds) {
        const i = vendorInvoices.find((x) => x.id === id)!;
        perInvoice.set(id, Decimal.max(perInvoice.get(id) ?? 0, cad(i)));
      }
    } else if (r.stakeInvoiceIds[0]) {
      perInvoice.set(r.stakeInvoiceIds[0], Decimal.max(perInvoice.get(r.stakeInvoiceIds[0]) ?? 0, r.atStakeCad));
    }
  }
  const totalAtStakeCad = [...perInvoice.values()].reduce((s, d) => s.plus(d), new Decimal(0)).toFixed(2);
  const byCode: Record<string, number> = {};
  for (const r of rows) byCode[r.code] = (byCode[r.code] ?? 0) + 1;

  return { rows, totalAtStakeCad, invoicesAtStake: perInvoice.size, byCode };
}
