"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { getUser, setSession, clearSession } from "@/lib/auth";
import type { ActionResult } from "@/components/ActionForm";
import { submitForm, submitPdf } from "@/services/rawIntake.service";
import { pollInbox } from "@/services/inboxPolling.service";
import { extract } from "@/services/pipeline.service";
import { saveEdits, resolveFlag, approve, reject, type ReviewEdit } from "@/services/parsedInvoiceReview.service";
import { decide, setDelegate } from "@/services/approval.service";
import { preparePayment, releasePayment } from "@/services/payment.service";
import { runBankSimulation } from "@/services/bankSimulator.service";
import { onboardVendor, setVendorStatus, requestBankChange, decideBankChange, confirmBankChangeByCallback } from "@/services/vendor.service";
import { saveUser, removeUser, savePolicy, createOrganization, updateOrganization } from "@/services/organization.service";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v == null || v === "" ? null : String(v);
};
const numOrNull = (fd: FormData, k: string) => (str(fd, k) == null ? null : Number(str(fd, k)));

async function run(fn: () => Promise<unknown>, ok: string, paths: string[] = []): Promise<{ error?: string; ok?: string }> {
  try {
    await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return { error: e instanceof Error ? e.message : String(e) };
  }
  for (const p of paths) revalidatePath(p);
  return { ok };
}

// --- sessions ---
export async function login(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email") ?? "";
  const brim = fd.get("brim") === "1";
  const u = await one<{ user_id: string; role: string }>("SELECT user_id, role FROM users WHERE lower(email)=lower($1) AND status<>'terminated'", [email]);
  if (!u || (brim ? u.role !== "brim_employee" : u.role === "brim_employee")) return { error: "No account with that email here." };
  await setSession(u.user_id);
  redirect(brim ? "/organizations" : "/dashboard");
}

export async function logout() {
  await clearSession();
  redirect("/");
}

// --- raw intake ---
export async function pollAction(_: ActionResult): Promise<ActionResult> {
  let r = { added: 0, skipped: 0 };
  const res = await run(async () => (r = await pollInbox(await getUser())), "", ["/invoices"]);
  return res.error ? res : { ok: `${r.added} new email${r.added === 1 ? "" : "s"} (${r.skipped} already in).` };
}

export async function uploadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose a PDF or image." };
  const res = await run(async () => submitPdf(await getUser(), file.name, Buffer.from(await file.arrayBuffer())), "", ["/invoices"]);
  if (res.error) return res;
  redirect("/invoices");
}

export async function formAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const amount = Number(str(fd, "amount") ?? 0);
  const tax = Number(str(fd, "tax") ?? 0);
  const form = {
    document_type: "invoice",
    vendor_id: str(fd, "vendor_id"),
    vendor_name: str(fd, "vendor_name"),
    vendor_invoice_number: str(fd, "vendor_invoice_number"),
    invoice_date: str(fd, "invoice_date"),
    due_date: str(fd, "due_date"),
    currency: str(fd, "currency") ?? "CAD",
    po_reference: str(fd, "po_reference"),
    bill_to_name: "Harborline Logistics Inc.",
    bill_to_address: str(fd, "bill_to_address"),
    subtotal: amount,
    taxes: tax ? [{ label: str(fd, "tax_label") ?? "GST", rate: null, amount: tax }] : [],
    total: amount + tax,
    lines: [{ line_no: 1, description: str(fd, "description") ?? "", quantity: 1, unit_price: amount, amount }],
    manual: str(fd, "vendor_id") ? ["vendor_id"] : [],
  };
  const res = await run(async () => submitForm(await getUser(), form), "", ["/invoices"]);
  if (res.error) return res;
  redirect("/invoices");
}

export async function extractAction(rawItemId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => extract(await getUser(), rawItemId), "Extracted.", ["/invoices"]);
}

// --- review ---
export async function saveReviewAction(parsedId: string, lineNos: number[], _: ActionResult, fd: FormData): Promise<ActionResult> {
  const header: ReviewEdit["header"] = {};
  for (const k of ["vendor_id", "vendor_invoice_number", "invoice_date", "due_date", "department_id", "requester_user_id", "po_id", "ship_to_province", "subtotal", "total"] as const) {
    if (fd.has(k)) header[k] = str(fd, k);
  }
  const lines = lineNos.map((n) => ({
    line_no: n,
    gl_account: str(fd, `gl_${n}`),
    department_id: str(fd, `dept_${n}`),
    line_type: (str(fd, `type_${n}`) ?? "services") as "goods" | "services",
  }));
  return run(async () => saveEdits(await getUser(), parsedId, { header, lines }), "Saved; checks ran again.", [`/invoices/${parsedId}`]);
}

export async function resolveFlagAction(flagId: string, path: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const status = (str(fd, "status") ?? "resolved") as "resolved" | "overridden";
  return run(async () => resolveFlag(await getUser(), flagId, status, str(fd, "note") ?? ""), "Flag updated.", [path]);
}

export async function approveParsedAction(parsedId: string, _: ActionResult): Promise<ActionResult> {
  let id = "";
  const res = await run(async () => (id = await approve(await getUser(), parsedId)), "", ["/invoices"]);
  if (res.error) return res;
  redirect(`/invoices/${id}`);
}

export async function rejectParsedAction(parsedId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => reject(await getUser(), parsedId, str(fd, "reason") ?? ""), "Rejected.", ["/invoices", `/invoices/${parsedId}`]);
}

// --- approvals ---
export async function decideAction(approvalId: string, invoiceId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const decision = str(fd, "decision") === "rejected" ? "rejected" : "approved";
  return run(async () => decide(await getUser(), approvalId, decision, str(fd, "comment")), decision === "approved" ? "Approved." : "Rejected.", [`/invoices/${invoiceId}`, "/invoices"]);
}

export async function delegateAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const onLeave = fd.get("on_leave") === "1";
  return run(async () => setDelegate(await getUser(), onLeave, str(fd, "delegate_user_id")), onLeave ? "Delegate set." : "Back from leave.", ["/dashboard"]);
}

// --- payments ---
export async function prepareAction(invoiceId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => preparePayment(await getUser(), invoiceId), "Payment scheduled.", [`/invoices/${invoiceId}`, "/payments"]);
}

export async function releaseAction(paymentId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => releasePayment(await getUser(), paymentId), "Released.", ["/payments", `/payments/${paymentId}`]);
}

export async function simulateAction(_: ActionResult): Promise<ActionResult> {
  let n = 0;
  const res = await run(async () => (n = await runBankSimulation(await getUser())), "", ["/payments"]);
  return res.error ? res : { ok: `${n} released payment${n === 1 ? "" : "s"} sent to the bank.` };
}

// --- vendors ---
export async function onboardVendorAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const res = await run(async () => {
    id = await onboardVendor(await getUser(), {
      legal_name: str(fd, "legal_name") ?? "",
      category: str(fd, "category"),
      default_gl_account: str(fd, "default_gl_account"),
      address: str(fd, "address"),
      province_or_state: str(fd, "province_or_state"),
      country: str(fd, "country") ?? "CA",
      gst_hst_number: str(fd, "gst_hst_number"),
      qst_number: str(fd, "qst_number"),
      payment_terms_days: numOrNull(fd, "payment_terms_days"),
      preferred_payment_method: (str(fd, "preferred_payment_method") ?? "EFT") as "EFT",
      bank_institution: str(fd, "bank_institution"),
      bank_transit: str(fd, "bank_transit"),
      bank_account: str(fd, "bank_account"),
      ap_contact_email: str(fd, "ap_contact_email"),
      requires_po: fd.get("requires_po") === "on",
    });
  }, "", ["/vendors"]);
  if (res.error) return res;
  redirect(`/vendors/${id}`);
}

export async function vendorStatusAction(vendorId: string, status: "active" | "on_hold", _: ActionResult): Promise<ActionResult> {
  return run(async () => setVendorStatus(await getUser(), vendorId, status), status === "active" ? "Vendor approved." : "Vendor on hold.", [`/vendors/${vendorId}`, "/vendors"]);
}

export async function bankChangeAction(vendorId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    async () =>
      requestBankChange(await getUser(), vendorId, {
        institution: str(fd, "institution") ?? "",
        transit: str(fd, "transit") ?? "",
        account: str(fd, "account") ?? "",
        channel: str(fd, "channel") ?? "email_request",
        verifiedByCallback: fd.get("verified") === "on",
      }),
    "Change requested; the finance manager approves it.",
    [`/vendors/${vendorId}`],
  );
}

export async function decideBankChangeAction(changeId: string, vendorId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  const decision = str(fd, "decision") === "rejected" ? "rejected" : "approved";
  return run(async () => decideBankChange(await getUser(), changeId, decision, fd.get("verified") === "on"), `Change ${decision}.`, [`/vendors/${vendorId}`]);
}

export async function confirmCallbackAction(changeId: string, vendorId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => confirmBankChangeByCallback(await getUser(), changeId), "Confirmed by callback.", [`/vendors/${vendorId}`]);
}

// --- settings ---
export async function saveUserAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    async () =>
      saveUser(await getUser(), {
        user_id: str(fd, "user_id") ?? undefined,
        full_name: str(fd, "full_name") ?? "",
        email: str(fd, "email") ?? "",
        title: str(fd, "title"),
        department_id: str(fd, "department_id"),
        manager_id: str(fd, "manager_id"),
        role: (str(fd, "role") ?? "employee") as "employee",
        approval_limit_cad: Number(str(fd, "approval_limit_cad") ?? 0),
        work_province: str(fd, "work_province"),
        status: (str(fd, "status") ?? "active") as "active",
        delegate_user_id: str(fd, "delegate_user_id"),
      }),
    "Saved.",
    ["/settings/users"],
  );
}

export async function removeUserAction(userId: string, _: ActionResult): Promise<ActionResult> {
  return run(async () => removeUser(await getUser(), userId), "Removed.", ["/settings/users"]);
}

export async function savePolicyAction(ruleId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    async () => savePolicy(await getUser(), ruleId, { trigger_value: numOrNull(fd, "trigger_value"), step_role: str(fd, "step_role"), is_active: fd.get("is_active") === "on" }),
    "Saved.",
    ["/settings/policies"],
  );
}

// --- organizations (Brim employees) ---
export async function createOrgAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const res = await run(async () => (id = await createOrganization(await getUser(), { legal_name: str(fd, "legal_name") ?? "", gst_hst_number: str(fd, "gst_hst_number") ?? undefined })), "", ["/organizations"]);
  if (res.error) return res;
  redirect(`/organizations/${id}`);
}

export async function updateOrgAction(orgId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    async () => updateOrganization(await getUser(), orgId, { legal_name: str(fd, "legal_name") ?? "", gst_hst_number: str(fd, "gst_hst_number"), base_currency: str(fd, "base_currency") ?? "CAD" }),
    "Saved.",
    [`/organizations/${orgId}`],
  );
}
