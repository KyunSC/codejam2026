/**
 * Invoices: who sees which, the invoice form, and the full record for the invoice page.
 *
 * Who sees what: AP clerks, finance managers, controllers and auditors may see every invoice
 * of their organization. Everyone else sees the invoices they brought in or that wait on them.
 * "Mine" for an AP clerk also includes inbox invoices nobody has picked up yet.
 */
import type { Prisma, User } from "@/generated/prisma/client";
import { type Actor, listActions, logAction } from "@/lib/audit";
import { canReadAllInvoices } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { toIsoDate } from "@/lib/today";
import { SENT_STATUSES, STATUS_LABEL } from "./labels";

/** Brought in by the user or waiting on them; for an AP clerk also intake-stage invoices with no owner. */
function mineWhere(user: User): Prisma.InvoiceWhereInput {
  const or: Prisma.InvoiceWhereInput[] = [{ createdById: user.id }, { assignedToId: user.id }];
  if (user.role === "approver") {
    // Matrix "Read invoices" for an approver: own department, plus steps assigned to them (or held for them).
    const pid = user.externalId ?? user.id;
    if (user.departmentId) or.push({ departmentId: user.departmentId });
    or.push({ approvalSteps: { some: { OR: [{ assignedToId: pid }, { onBehalfOfId: pid }] } } });
  }
  if (user.role === "ap_clerk") {
    or.push({ assignedToId: null, status: { in: ["received", "extracted", "needs_review", "coded"] } });
  }
  return { OR: or };
}

export interface InvoiceFilter {
  /** "mine" (default) or "all"; "all" only for roles that may read every invoice. */
  scope?: string;
  /** Matches vendor, invoice number, file name, email subject or sender. */
  q?: string;
  status?: string;
  source?: string;
}

const listInclude = {
  document: { select: { fileName: true, mimeType: true } },
  email: { select: { fromAddress: true, subject: true } },
  createdBy: { select: { id: true, fullName: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceListRow = Prisma.InvoiceGetPayload<{ include: typeof listInclude }>;

/** The invoices a user may see, split into those still in progress and those whose payment went out. */
export async function listInvoicesFor(user: User, f: InvoiceFilter = {}) {
  const all = f.scope === "all" && canReadAllInvoices(user.role);
  const q = f.q?.trim();
  const where: Prisma.InvoiceWhereInput = {
    organizationId: user.organizationId,
    AND: [
      all ? {} : mineWhere(user),
      q
        ? {
            OR: [
              { vendorName: { contains: q, mode: "insensitive" } },
              { invoiceNumber: { contains: q, mode: "insensitive" } },
              { poNumber: { contains: q, mode: "insensitive" } },
              { document: { fileName: { contains: q, mode: "insensitive" } } },
              { email: { subject: { contains: q, mode: "insensitive" } } },
              { email: { fromAddress: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {},
      f.status && STATUS_LABEL[f.status] ? { status: f.status } : {},
      f.source && ["inbox", "upload", "submission", "manual", "history"].includes(f.source)
        ? { source: f.source as "inbox" | "upload" | "submission" | "manual" | "history" }
        : {},
    ],
  };
  const rows = await db().invoice.findMany({ where, include: listInclude, orderBy: { createdAt: "desc" }, take: 500 });
  return {
    inProgress: rows.filter((r) => !SENT_STATUSES.includes(r.status)),
    sent: rows.filter((r) => SENT_STATUSES.includes(r.status)),
    scope: all ? "all" : "mine",
  };
}

const detailInclude = {
  document: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true } },
  email: true,
  createdBy: { select: { id: true, fullName: true, role: true, externalId: true } },
  assignedTo: { select: { id: true, fullName: true, role: true, externalId: true } },
  lines: { orderBy: { lineNo: "asc" } },
  taxes: true,
  flags: { orderBy: { createdAt: "asc" } },
  approvalSteps: { orderBy: { stepNo: "asc" } },
  payments: true,
} satisfies Prisma.InvoiceInclude;

export type InvoiceDetail = Prisma.InvoiceGetPayload<{ include: typeof detailInclude }>;

/** One invoice with its file, email, lines and history, if this user may see it. Brim admins pass null. */
export async function getInvoiceFor(organizationId: string, user: User | null, id: string) {
  const invoice = await db().invoice.findFirst({
    where: {
      id,
      organizationId,
      ...(user && !canReadAllInvoices(user.role) ? mineWhere(user) : {}),
    },
    include: detailInclude,
  });
  if (!invoice) throw new AppError(404, "INVOICE_NOT_FOUND", "No such invoice, or it isn't yours to see.");
  const history = await listActions(organizationId, { invoiceId: invoice.id, limit: 200 });
  const actorIds = [...new Set(history.map((h) => h.actorId).filter((x): x is string => !!x))];
  const people = await db().user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
  const names = Object.fromEntries(people.map((p) => [p.id, p.fullName]));
  return { invoice, history: history.reverse().map((h) => ({ ...h, actorName: h.actorId ? (names[h.actorId] ?? null) : null })) };
}

/** The stored file of an invoice this user may see. */
export async function getDocumentFor(organizationId: string, user: User | null, documentId: string) {
  const invoice = await db().invoice.findFirst({
    where: { organizationId, documentId, ...(user && !canReadAllInvoices(user.role) ? mineWhere(user) : {}) },
    select: { id: true },
  });
  if (!invoice) throw new AppError(404, "DOCUMENT_NOT_FOUND", "No such file, or it isn't yours to see.");
  const doc = await db().document.findUnique({ where: { id: documentId } });
  if (!doc) throw new AppError(404, "DOCUMENT_NOT_FOUND", "No such file.");
  return doc;
}

// ---------- The invoice form ----------

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function money(v: unknown, field: string, scale = 2): string | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(/[$,\s]/g, "") : v);
  if (!Number.isFinite(n)) throw new AppError(422, "BAD_FIELD", `${field}: must be a number`);
  return n.toFixed(scale);
}

function date(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = typeof v === "string" ? toIsoDate(v) : null;
  if (!d) throw new AppError(422, "BAD_FIELD", `${field}: must be a date written YYYY-MM-DD`);
  return new Date(`${d}T00:00:00Z`);
}

/**
 * An invoice typed into the form, with no file. Values are stored as typed; nothing is
 * computed or checked against each other yet. Vendor, invoice number and total are required.
 */
export async function createManualInvoice(organizationId: string, actor: Actor, input: Record<string, unknown>) {
  const vendorName = text(input.vendorName);
  const invoiceNumber = text(input.invoiceNumber);
  const total = money(input.total, "total");
  if (!vendorName) throw new AppError(422, "BAD_FIELD", "vendorName: is required");
  if (!invoiceNumber) throw new AppError(422, "BAD_FIELD", "invoiceNumber: is required");
  if (total === null) throw new AppError(422, "BAD_FIELD", "total: is required");
  const currency = text(input.currency)?.toUpperCase() ?? "CAD";
  if (!["CAD", "USD"].includes(currency)) throw new AppError(422, "BAD_FIELD", "currency: must be CAD or USD");

  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = rawLines
    .map((l: Record<string, unknown>, i: number) => ({
      lineNo: i + 1,
      description: text(l?.description) ?? "",
      quantity: money(l?.quantity, `lines[${i + 1}].quantity`, 4),
      unitPrice: money(l?.unitPrice, `lines[${i + 1}].unitPrice`, 4),
      amount: money(l?.amount, `lines[${i + 1}].amount`),
    }))
    .filter((l) => l.description || l.amount !== null);
  lines.forEach((l, i) => {
    l.lineNo = i + 1;
    if (!l.description) throw new AppError(422, "BAD_FIELD", `lines[${i + 1}].description: is required`);
  });

  return db().$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        organizationId,
        source: "manual",
        createdById: actor.type === "user" ? actor.userId : null,
        vendorName,
        invoiceNumber,
        invoiceDate: date(input.invoiceDate, "invoiceDate"),
        dueDate: date(input.dueDate, "dueDate"),
        currency,
        subtotal: money(input.subtotal, "subtotal"),
        gstHstAmount: money(input.gstHstAmount, "gstHstAmount"),
        pstQstAmount: money(input.pstQstAmount, "pstQstAmount"),
        total,
        poNumber: text(input.poNumber),
        note: text(input.note),
        lines: { create: lines },
      },
      include: { lines: true },
    });
    await logAction(tx, { organizationId, actor, action: "invoice.created", entityType: "invoice", entityId: invoice.id, after: invoice });
    return invoice;
  });
}
