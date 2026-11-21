/**
 * Vendors and bank changes (BUILD_PLAN Vendor management and bank changes):
 *
 * - listVendors / getVendor: what the role may see (VENDOR_VIEW: names only, bank last 4, no bank,
 *   full). The detail shows the vendor's AP invoices and the card charges at its merchant name together.
 * - onboardVendor (AP clerk): created `pending_review`; 409 VENDOR_EXISTS for a known tax number.
 * - approveVendor / holdVendor / releaseHold (finance manager, controller): FOUR_EYES against whoever
 *   created the vendor (approve) or placed the hold (release).
 * - requestBankChange (AP clerk): a pending request; the live account does not change.
 * - verifyBankChange / rejectBankChange (finance manager, controller, not the requester → FOUR_EYES):
 *   verify needs "called back on the number on file" and a note (422 CALLBACK_REQUIRED). Verifying makes
 *   the new account live and clears the BANK_CHANGE_UNVERIFIED flags on the vendor's open invoices.
 *
 * Every change writes its audit row in the same transaction.
 */
import type { Prisma, User } from "@/generated/prisma/client";
import { logAction } from "@/lib/audit";
import { authorize, checkFourEyes, checkNotReadOnly, firstFailure, VENDOR_VIEW, type VendorView } from "@/lib/auth/matrix";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { AppError } from "@/lib/http";
import { merchantDescriptor } from "@/lib/rules/keys";
import { today } from "@/lib/today";
import { enforce, type WorkflowActor } from "./guard";
import { PROCESSABLE, processInvoice } from "./process";

type Tx = Prisma.TransactionClient;

const mask = (last4: string | null | undefined) => (last4 ? `•••• ${last4}` : null);

type VendorRow = Prisma.VendorGetPayload<{ include: { bankAccounts: true } }>;

/** A vendor as this role may see it. */
export function vendorView(v: VendorRow, view: VendorView) {
  const live = v.bankAccounts.find((a) => a.validTo === null) ?? null;
  const base = { id: v.id, legalName: v.legalName, category: v.category, status: v.status };
  if (view === "names") return base;
  const details = {
    ...base,
    address: v.address,
    provinceOrState: v.provinceOrState,
    country: v.country,
    gstHstNumber: v.gstHstNumber,
    qstNumber: v.qstNumber,
    paymentTermsDays: v.paymentTermsDays,
    earlyPayDiscount: v.earlyPayDiscount,
    preferredPaymentMethod: v.preferredPaymentMethod,
    apContactEmail: v.apContactEmail,
    requiresPo: v.requiresPo,
    defaultGlAccount: v.defaultGlAccount,
    onboardedAt: v.onboardedAt,
  };
  if (view === "no_bank") return details;
  if (view === "bank_last4") return { ...details, bank: live ? { last4: mask(live.last4), since: live.validFrom } : null };
  return {
    ...details,
    bank: live ? { institution: live.institution, transit: live.transit, account: live.account, last4: mask(live.last4), since: live.validFrom } : null,
  };
}

export async function listVendors(user: User, q?: string) {
  enforce(authorize({ userId: user.id, role: user.role, departmentId: user.departmentId ?? "" }, "vendor.read"));
  const rows = await db().vendor.findMany({
    where: {
      organizationId: user.organizationId,
      ...(q?.trim() ? { OR: [{ legalName: { contains: q.trim(), mode: "insensitive" } }, { id: q.trim().toUpperCase() }] } : {}),
    },
    include: { bankAccounts: true },
    orderBy: { id: "asc" },
  });
  const view = VENDOR_VIEW[user.role];
  return rows.map((v) => vendorView(v, view));
}

export async function getVendor(user: User, vendorId: string) {
  enforce(authorize({ userId: user.id, role: user.role, departmentId: user.departmentId ?? "" }, "vendor.read"));
  const organizationId = user.organizationId;
  const v = await db().vendor.findFirst({ where: { organizationId, id: vendorId }, include: { bankAccounts: true } });
  if (!v) throw new AppError(404, "VENDOR_NOT_FOUND", `No vendor ${vendorId}.`);
  const view = VENDOR_VIEW[user.role];
  const vendor = vendorView(v, view);
  if (view === "names") return { vendor, invoices: [], cardCharges: [], bankChanges: [], flags: [] };
  const descriptor = merchantDescriptor(v.legalName, config.duplicates.cardMerchantMaxLen);
  const [invoices, cardCharges, bankChanges, flags] = await Promise.all([
    db().invoice.findMany({
      where: { organizationId, vendorId },
      select: { id: true, invoiceNumber: true, invoiceDate: true, total: true, currency: true, status: true, source: true },
      orderBy: [{ invoiceDate: "desc" }, { id: "desc" }],
    }),
    db().cardTransaction.findMany({
      where: { organizationId, merchantDescriptor: descriptor },
      select: { id: true, postedDate: true, amount: true, currency: true, source: true, cardId: true, memo: true },
      orderBy: { postedDate: "desc" },
    }),
    view === "no_bank"
      ? Promise.resolve([])
      : db().bankChangeRequest.findMany({ where: { organizationId, vendorId }, orderBy: { requestedAt: "desc" } }),
    db().flag.findMany({ where: { organizationId, vendorId, status: "open" }, select: { id: true, code: true, klass: true, message: true, invoiceId: true } }),
  ]);
  const changes = bankChanges.map((c) => ({
    id: c.id,
    channel: c.channel,
    requestedAt: c.requestedAt,
    requestedById: c.requestedById,
    status: c.status,
    oldLast4: mask(c.oldLast4),
    newLast4: mask(c.newLast4),
    verifiedById: c.verifiedById,
    verifiedAt: c.verifiedAt,
    verifiedByCallback: c.verifiedByCallback,
    note: c.note,
    ...(view === "full" ? { newInstitution: c.newInstitution, newTransit: c.newTransit, newAccount: c.newAccount } : {}),
  }));
  return { vendor, invoices, cardCharges, bankChanges: changes, flags, createdById: v.createdById };
}

function check(actor: WorkflowActor, action: Parameters<typeof authorize>[1], requestedBy?: string | null) {
  enforce(firstFailure(authorize(actor.matrix, action), checkNotReadOnly(actor.matrix), ...(requestedBy !== undefined ? [checkFourEyes(actor.matrix, requestedBy)] : [])));
}

async function nextVendorId(tx: Tx, organizationId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ids:vendor:${organizationId}`}))`;
  const rows = await tx.vendor.findMany({ where: { organizationId }, select: { id: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(1)) || 0), 0);
  return `V${String(max + 1).padStart(3, "0")}`;
}

async function nextBankChangeId(tx: Tx, organizationId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ids:bankchange:${organizationId}`}))`;
  const rows = await tx.bankChangeRequest.findMany({ where: { organizationId }, select: { id: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id.slice(3)) || 0), 0);
  return `BC-${String(max + 1).padStart(3, "0")}`;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const digits = (v: unknown) => (typeof v === "string" ? v.replace(/\s/g, "") : "");
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);

export async function onboardVendor(tx: Tx, actor: WorkflowActor, input: Record<string, unknown>) {
  check(actor, "vendor.onboard");
  const organizationId = actor.user.organizationId;
  const legalName = text(input.legalName);
  const apContactEmail = text(input.apContactEmail);
  const category = text(input.category);
  const defaultGlAccount = text(input.defaultGlAccount);
  if (!legalName || !apContactEmail || !category || !defaultGlAccount) {
    throw new AppError(422, "BAD_FIELD", "legalName, category, defaultGlAccount and apContactEmail are required.");
  }
  const gstHstNumber = text(input.gstHstNumber);
  if (gstHstNumber) {
    const same = await tx.vendor.findFirst({ where: { organizationId, gstHstNumber } });
    if (same) throw new AppError(409, "VENDOR_EXISTS", `${same.id} ${same.legalName} already has tax number ${gstHstNumber}.`);
  }
  const method = text(input.preferredPaymentMethod)?.toUpperCase() ?? "EFT";
  if (!["EFT", "CHEQUE", "CARD"].includes(method)) throw new AppError(422, "BAD_FIELD", "preferredPaymentMethod: EFT, CHEQUE or CARD.");
  const id = await nextVendorId(tx, organizationId);
  const vendor = await tx.vendor.create({
    data: {
      organizationId,
      id,
      legalName,
      category,
      defaultGlAccount,
      address: text(input.address) ?? "",
      provinceOrState: text(input.provinceOrState) ?? "",
      country: text(input.country)?.toUpperCase() === "US" ? "US" : "CA",
      gstHstNumber,
      qstNumber: text(input.qstNumber),
      paymentTermsDays: Number.isInteger(input.paymentTermsDays) ? (input.paymentTermsDays as number) : 30,
      preferredPaymentMethod: method,
      acceptsCardPayment: method === "CARD",
      apContactEmail,
      requiresPo: input.requiresPo === true,
      status: "pending_review",
      onboardedAt: dateOnly(today()),
      createdById: actor.user.id,
    },
  });
  const account = digits(input.account);
  if (account) {
    await tx.vendorBankAccount.create({
      data: { organizationId, vendorId: id, institution: text(input.institution), transit: text(input.transit), account, last4: account.slice(-4), validFrom: dateOnly(today()) },
    });
  }
  await logAction(tx, { organizationId, actor: actor.audit, action: "vendor.onboard", entityType: "vendor", entityId: id, after: { ...vendor, account: account ? mask(account.slice(-4)) : null } });
  return vendor;
}

/** Who placed the vendor's current hold (from the audit log), for FOUR_EYES on release. */
async function holdPlacedBy(tx: Tx, organizationId: string, vendorId: string): Promise<string | null> {
  const ev = await tx.auditEvent.findFirst({ where: { organizationId, entityType: "vendor", entityId: vendorId, action: "vendor.hold" }, orderBy: { seq: "desc" } });
  return ev?.actorId ?? null;
}

export async function setVendorStatus(tx: Tx, actor: WorkflowActor, vendorId: string, kind: "approve" | "hold" | "release-hold", reason: string | null) {
  const organizationId = actor.user.organizationId;
  const v = await tx.vendor.findFirst({ where: { organizationId, id: vendorId } });
  if (!v) throw new AppError(404, "VENDOR_NOT_FOUND", `No vendor ${vendorId}.`);
  const from = v.status;
  let to: string;
  if (kind === "approve") {
    check(actor, "vendor.approve", v.createdById);
    if (from !== "pending_review") throw new AppError(409, "INVALID_STATE", `${v.legalName} is ${from}; only a vendor pending review is approved.`);
    to = "active";
  } else if (kind === "hold") {
    check(actor, "vendor.approve");
    if (!reason?.trim()) throw new AppError(422, "REASON_REQUIRED", "Say why the vendor is held.");
    if (from === "on_hold") throw new AppError(409, "INVALID_STATE", `${v.legalName} is already on hold.`);
    to = "on_hold";
  } else {
    check(actor, "vendor.approve", await holdPlacedBy(tx, organizationId, vendorId));
    if (from !== "on_hold") throw new AppError(409, "INVALID_STATE", `${v.legalName} is ${from}, not on hold.`);
    if (!reason?.trim()) throw new AppError(422, "REASON_REQUIRED", "Say why the hold is released.");
    to = "active";
  }
  const updated = await tx.vendor.update({ where: { organizationId_id: { organizationId, id: vendorId } }, data: { status: to } });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: `vendor.${kind === "release-hold" ? "release_hold" : kind}`,
    entityType: "vendor",
    entityId: vendorId,
    before: { status: from },
    after: { status: to },
    reason: reason?.trim() || null,
  });
  return updated;
}

export async function requestBankChange(tx: Tx, actor: WorkflowActor, vendorId: string, input: Record<string, unknown>) {
  check(actor, "vendor.bank_change.request");
  const organizationId = actor.user.organizationId;
  const v = await tx.vendor.findFirst({ where: { organizationId, id: vendorId }, include: { bankAccounts: true } });
  if (!v) throw new AppError(404, "VENDOR_NOT_FOUND", `No vendor ${vendorId}.`);
  const account = digits(input.account);
  if (!/^\d{5,17}$/.test(account)) throw new AppError(422, "BAD_FIELD", "account: digits only.");
  const channel = text(input.channel) ?? "email_request";
  if (!["email_request", "phone_callback_verified", "vendor_portal"].includes(channel)) {
    throw new AppError(422, "BAD_FIELD", "channel: email_request, phone_callback_verified or vendor_portal.");
  }
  const live = v.bankAccounts.find((a) => a.validTo === null);
  const id = await nextBankChangeId(tx, organizationId);
  const req = await tx.bankChangeRequest.create({
    data: {
      organizationId,
      id,
      vendorId,
      oldLast4: live?.last4 ?? "",
      newLast4: account.slice(-4),
      newInstitution: text(input.institution),
      newTransit: text(input.transit),
      newAccount: account,
      channel,
      requestedById: actor.user.id,
      requestedAt: dateOnly(today()),
      status: "pending",
      source: "app",
    },
  });
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: "vendor.bank_change.request",
    entityType: "bank_change",
    entityId: id,
    vendorId,
    after: { channel, oldLast4: req.oldLast4, newLast4: req.newLast4 },
  });
  return req;
}

export async function decideBankChange(
  tx: Tx,
  actor: WorkflowActor,
  changeId: string,
  kind: "verify" | "reject",
  input: { calledBack?: boolean; note?: string | null },
) {
  const organizationId = actor.user.organizationId;
  const req = await tx.bankChangeRequest.findFirst({ where: { organizationId, id: changeId } });
  if (!req) throw new AppError(404, "BANK_CHANGE_NOT_FOUND", `No bank change ${changeId}.`);
  check(actor, "vendor.bank_change.verify", req.requestedById);
  if (req.status !== "pending") throw new AppError(409, "INVALID_STATE", `${changeId} is already ${req.status}.`);
  const note = input.note?.trim() || null;
  if (kind === "verify" && (!input.calledBack || !note)) {
    throw new AppError(422, "CALLBACK_REQUIRED", "Call the vendor back on the number already on file, tick that you did, and note who confirmed the new account.");
  }
  if (kind === "reject" && !note) throw new AppError(422, "REASON_REQUIRED", "Say why the change is rejected.");

  const at = new Date();
  await tx.bankChangeRequest.update({
    where: { organizationId_id: { organizationId, id: changeId } },
    data: { status: kind === "verify" ? "verified" : "rejected", verifiedById: actor.user.id, verifiedAt: at, verifiedByCallback: kind === "verify", note },
  });

  const live = await tx.vendorBankAccount.findFirst({ where: { organizationId, vendorId: req.vendorId, validTo: null } });
  let held = false;
  if (kind === "verify" && req.newAccount && live?.account !== req.newAccount) {
    if (live) await tx.vendorBankAccount.update({ where: { id: live.id }, data: { validTo: dateOnly(today()) } });
    await tx.vendorBankAccount.create({
      data: { organizationId, vendorId: req.vendorId, institution: req.newInstitution, transit: req.newTransit, account: req.newAccount, last4: req.newLast4, validFrom: dateOnly(today()), changeRequestId: req.id },
    });
  }
  if (kind === "reject" && live?.last4 === req.newLast4) {
    // The rejected account is already the one on file (imported history, e.g. BC-009): the old full account
    // is unknown, so the vendor goes on hold until someone sets a verified account.
    await tx.vendor.update({ where: { organizationId_id: { organizationId, id: req.vendorId } }, data: { status: "on_hold" } });
    held = true;
  }
  await logAction(tx, {
    organizationId,
    actor: actor.audit,
    action: `vendor.bank_change.${kind}`,
    entityType: "bank_change",
    entityId: changeId,
    vendorId: req.vendorId,
    before: { status: "pending" },
    after: { status: kind === "verify" ? "verified" : "rejected", calledBack: !!input.calledBack, vendorHeld: held },
    reason: note,
  });
  if (held) {
    await logAction(tx, {
      organizationId,
      actor: actor.audit,
      action: "vendor.hold",
      entityType: "vendor",
      entityId: req.vendorId,
      after: { status: "on_hold" },
      reason: `Bank change ${changeId} rejected and the account on file is the rejected one.`,
    });
  }

  // The unverified-change flags on this vendor's open invoices no longer hold once the change is verified.
  if (kind === "verify") {
    const flags = await tx.flag.findMany({ where: { organizationId, code: "BANK_CHANGE_UNVERIFIED", status: "open", invoice: { vendorId: req.vendorId } }, select: { id: true, invoiceId: true } });
    for (const f of flags) {
      await tx.flag.update({ where: { id: f.id }, data: { status: "fixed", resolvedById: actor.user.id, resolvedAt: at, resolutionNote: `Bank change ${changeId} verified by callback.` } });
      await logAction(tx, { organizationId, actor: actor.audit, action: "flag.fixed", entityType: "flag", entityId: f.id, invoiceId: f.invoiceId, before: { status: "open" }, after: { status: "fixed" }, reason: `Bank change ${changeId} verified by callback.` });
    }
    const inReview = await tx.invoice.findMany({ where: { organizationId, vendorId: req.vendorId, status: { in: [...PROCESSABLE] } }, select: { id: true, normalized: true } });
    for (const inv of inReview) {
      if (inv.normalized) await processInvoice(tx, { organizationId, invoiceId: inv.id, actor: actor.audit });
    }
  }
  return tx.bankChangeRequest.findFirstOrThrow({ where: { organizationId, id: changeId } });
}
