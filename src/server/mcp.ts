import { Router } from "express";
import * as z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { bearer, userFromToken } from "@/lib/auth";
import { auditChannel } from "@/lib/audit";
import { can, type Action } from "@/lib/authz";
import { AppError, fromDatabase } from "@/lib/errors";
import type { User } from "@/lib/types";
import {
  getInvoiceRecord, getParsedInvoiceRecord, getPaymentRecord, getRawItemRecord, listInvoices, listParsedInvoices, listPayments, listRawItems,
  listWaitingApprovals,
} from "@/services/read.service";
import { invoiceTrail } from "@/services/audit.service";
import { getOrganization } from "@/services/organization.service";
import { listRecords } from "@/services/records.service";
import { getVendor, listBankChanges, listVendorChoices, listVendors, requestBankChange } from "@/services/vendor.service";
import { pollAndRead, submitInvoiceForm } from "@/services/intake.service";
import { approve, reject, resolveFlag, saveEdits } from "@/services/parsedInvoiceReview.service";
import { decide } from "@/services/approval.service";
import { preparePayment, releasePayment } from "@/services/payment.service";

// The MCP server at /mcp: an employee's agent signs in with a personal access token and gets one tool per thing
// the employee's role may do. Each tool calls the same service as the REST route, so permissions and the audit log are the same;
// actions taken this way are marked "agent" in the audit log.

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) }] });

// A refusal from the services (not allowed, not found, not in that state) goes back to the agent as a tool error it can read.
async function attempt(f: () => Promise<unknown>): Promise<Result> {
  try {
    return ok(await f());
  } catch (err) {
    const e = fromDatabase(err) ?? err;
    if (e instanceof AppError) return { isError: true, content: [{ type: "text", text: e.message }] };
    console.error(err);
    return { isError: true, content: [{ type: "text", text: "The server could not do this." }] };
  }
}

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const page = z.number().int().min(1).optional().describe("Page number, 20 rows per page");

function serverFor(user: User) {
  const org = user.organization_id!;
  const server = new McpServer({ name: "brim-ap", version: "1.0.0" });
  // a tool is offered only when the user's role allows it; the services check again on every call
  const tool = <S extends z.ZodRawShape>(name: string, needs: Action | null, description: string, input: S, write: boolean, run: (a: z.infer<z.ZodObject<S>>) => Promise<unknown>) => {
    if (needs && !can(user, needs)) return;
    server.registerTool(name, { description, inputSchema: input, annotations: write ? WRITE : READ }, ((a: z.infer<z.ZodObject<S>>) => attempt(() => run(a))) as never);
  };

  // --- reading ---
  tool("whoami", null, "The signed-in employee: name, role, department and organization.", {}, false, async () => ({
    user_id: user.user_id, full_name: user.full_name, role: user.role, title: user.title, department_id: user.department_id,
    organization: (await getOrganization(user, org)).legal_name,
  }));
  tool("list_invoices", null, "Invoices the employee may see, those waiting on their approval first. Filter by status (pending_approval, approved, scheduled, paid, rejected) or vendor.",
    { status: z.string().optional(), vendor_id: z.string().optional(), page }, false,
    (a) => listInvoices(user, org, { status: a.status, vendor_id: a.vendor_id, page: a.page }));
  tool("get_invoice", null, "One invoice with its lines, approval chain (each step says whether the employee can act on it) and payments.",
    { invoice_id: z.string().describe("e.g. AP-00427") }, false, (a) => getInvoiceRecord(user, org, a.invoice_id));
  tool("get_invoice_audit_trail", null, "Everything that happened to an invoice, its parsed invoice and raw item, oldest first.",
    { invoice_id: z.string() }, false, (a) => invoiceTrail(user, org, a.invoice_id));
  tool("list_approvals_waiting_on_me", "approval.act", "Approval steps waiting on the employee, or on a colleague on leave they cover.", {}, false,
    () => listWaitingApprovals(user, org));
  tool("list_raw_items", null, "Raw items as they arrived (emails, uploads, forms), not yet extracted first. Filter by kind (email, pdf, form) or status (new, extracted, no_invoice).",
    { kind: z.string().optional(), status: z.string().optional(), page }, false,
    (a) => listRawItems(user, org, { kind: a.kind, status: a.status, page: a.page }));
  tool("get_raw_item", null, "One raw item: the email, form or upload as received (file names, not file contents).",
    { raw_item_id: z.string() }, false, async (a) => {
      const r = await getRawItemRecord(user, org, a.raw_item_id);
      return { ...r, files: r.files.map((f) => ({ file_name: f.file_name, mime_type: f.mime_type })) };
    });
  tool("list_parsed_invoices", null, "Parsed invoices waiting for the AP clerk's review (status pending), with their open blocking and warning flags.",
    { status: z.string().optional(), page }, false, (a) => listParsedInvoices(user, org, { status: a.status, page: a.page }));
  tool("get_parsed_invoice", null, "One parsed invoice with every field read from the document and its flags.",
    { parsed_invoice_id: z.string().describe("e.g. PRS-0428") }, false, (a) => getParsedInvoiceRecord(user, org, a.parsed_invoice_id));
  tool("list_payments", "payment.view", "Payments; for scheduled and released ones the earliest due first, and whether the employee may release each.",
    { status: z.string().optional().describe("scheduled, released, outstanding or settled"), page }, false,
    (a) => listPayments(user, org, { status: a.status, page: a.page }));
  tool("get_payment", "payment.view", "One payment: method, amount, dates, who prepared and released it, the bank account paid.",
    { payment_id: z.string() }, false, (a) => getPaymentRecord(user, org, a.payment_id));
  tool("list_vendor_names", null, "The organization's vendors by name and id, to pick the vendor of an invoice.", {}, false, () => listVendorChoices(user, org));
  tool("list_vendors", "vendor.view", "Vendors with their status, number of invoices, unverified bank changes and lookalike names. Filter by status (active, pending_review, on_hold).",
    { status: z.string().optional() }, false, (a) => listVendors(user, org, a.status));
  tool("get_vendor", "vendor.view", "One vendor's details and bank details changes.", { vendor_id: z.string() }, false, async (a) => ({
    ...(await getVendor(user, org, a.vendor_id)), bank_changes: await listBankChanges(user, org, { vendorId: a.vendor_id }),
  }));
  tool("list_departments", null, "The organization's departments, for coding an invoice.", {}, false, () => listRecords(user, org, "departments"));
  tool("list_gl_accounts", null, "Expense GL accounts, for coding invoice lines.", {}, false, () => listRecords(user, org, "gl_accounts", { account_type: "expense" }));

  // --- acting ---
  tool("submit_invoice", "raw.submit", "Submits an invoice the employee received, as a form. It becomes a parsed invoice at once, checked, for accounts payable to review. Totals are added up from the lines and taxes.", {
    vendor_id: z.string().describe("from list_vendor_names"),
    vendor_invoice_number: z.string(),
    invoice_date: z.string().describe("YYYY-MM-DD"),
    due_date: z.string().optional().describe("YYYY-MM-DD"),
    currency: z.enum(["CAD", "USD"]).default("CAD"),
    po_reference: z.string().optional().describe("one of the vendor's PO ids"),
    ship_to_province: z.enum(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]).describe("province the goods or services were delivered to; the tax depends on it"),
    bill_to_address: z.string().optional().describe("delivery address, if known"),
    lines: z.array(z.object({ description: z.string(), quantity: z.number().positive(), unit_price: z.number(), line_type: z.enum(["goods", "services"]).default("services") })).min(1),
    taxes: z.array(z.object({ label: z.string().describe("GST, HST, QST or PST"), amount: z.number() })).default([]),
  }, true, async (a) => {
    const lines = a.lines.map((l, i) => ({ line_no: i + 1, description: l.description, quantity: l.quantity, unit_price: l.unit_price, line_type: l.line_type, amount: Math.round(l.quantity * l.unit_price * 100) / 100 }));
    const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    const tax = a.taxes.reduce((s, t) => s + t.amount, 0);
    return submitInvoiceForm(user, {
      document_type: "invoice", vendor_id: a.vendor_id, vendor_invoice_number: a.vendor_invoice_number, invoice_date: a.invoice_date, due_date: a.due_date ?? null,
      currency: a.currency, po_reference: a.po_reference ?? null, ship_to_province: a.ship_to_province, bill_to_address: a.bill_to_address ?? null, bill_to_name: (await getOrganization(user, org)).legal_name,
      subtotal, taxes: a.taxes.map((t) => ({ label: t.label, rate: null, amount: t.amount })), total: Math.round((subtotal + tax) * 100) / 100, lines, manual: ["vendor_id", "ship_to_province"],
    }, { organizationId: org });
  });
  tool("poll_inbox", "raw.poll", "Reads the AP inbox and stores each new email as a raw item; new and earlier unread items are then read in the background into parsed invoices.", {}, true, () => pollAndRead(user));
  tool("edit_parsed_invoice", "parsed.review", "The clerk's corrections on a pending parsed invoice: header fields and line coding. The checks run again.", {
    parsed_invoice_id: z.string(),
    header: z.object({
      vendor_id: z.string().nullable(), vendor_invoice_number: z.string().nullable(), invoice_date: z.string().nullable(), due_date: z.string().nullable(),
      department_id: z.string().nullable(), requester_user_id: z.string().nullable(), po_id: z.string().nullable(), ship_to_province: z.string().nullable(),
    }).partial().default({}),
    lines: z.array(z.object({ line_no: z.number().int(), gl_account: z.string().nullable(), department_id: z.string().nullable(), line_type: z.enum(["goods", "services"]) })).default([]),
  }, true, async (a) => {
    await saveEdits(user, org, a.parsed_invoice_id, { header: a.header, lines: a.lines });
    return getParsedInvoiceRecord(user, org, a.parsed_invoice_id);
  });
  tool("resolve_flag", "parsed.review", "Closes a flag on a pending parsed invoice, with a note of what was checked: resolved, or overridden.",
    { flag_id: z.string(), status: z.enum(["resolved", "overridden"]), note: z.string().min(1) }, true,
    (a) => resolveFlag(user, org, a.flag_id, a.status, a.note));
  tool("approve_parsed_invoice", "parsed.review", "Adds a reviewed parsed invoice to the invoices and starts its approval chain. Refused while blocking flags are open.",
    { parsed_invoice_id: z.string() }, true, async (a) => ({ invoice_id: await approve(user, org, a.parsed_invoice_id) }));
  tool("reject_parsed_invoice", "parsed.review", "Rejects a parsed invoice, with the reason.", { parsed_invoice_id: z.string(), reason: z.string().min(1) }, true,
    (a) => reject(user, org, a.parsed_invoice_id, a.reason));
  tool("decide_approval", "approval.act", "Approves or rejects an approval step waiting on the employee. A rejection needs a comment.",
    { approval_id: z.string().describe("from list_approvals_waiting_on_me or get_invoice"), decision: z.enum(["approve", "reject"]), comment: z.string().optional() }, true,
    (a) => decide(user, org, a.approval_id, a.decision === "approve" ? "approved" : "rejected", a.comment ?? null));
  tool("prepare_payment", "payment.prepare", "Schedules the payment of an approved invoice for its due date, by the vendor's payment method.",
    { invoice_id: z.string() }, true, async (a) => ({ payment_id: await preparePayment(user, org, a.invoice_id) }));
  tool("release_payment", "payment.release", "Releases a scheduled payment to the bank run. Refused above the employee's limit, for an invoice they approved, or while the vendor's bank change is unverified.",
    { payment_id: z.string() }, true, async (a) => {
      await releasePayment(user, org, a.payment_id);
      return getPaymentRecord(user, org, a.payment_id);
    });
  tool("request_bank_change", "bank_change.request", "Requests a change of a vendor's bank details; the finance manager approves it after calling the vendor.", {
    vendor_id: z.string(), institution: z.string(), transit: z.string(), account: z.string(),
    channel: z.enum(["email_request", "phone_callback_verified", "vendor_portal"]).describe("how the vendor asked"),
  }, true, async (a) => ({ change_id: await requestBankChange(user, org, a.vendor_id, { institution: a.institution, transit: a.transit, account: a.account, channel: a.channel }) }));

  return server;
}

export const mcp = Router();
// local only: refuses requests whose Host header is not localhost (DNS rebinding)
mcp.use(localhostHostValidation());

// Stateless: each POST carries the token and gets a server for that employee.
mcp.post("/", async (req, res) => {
  const user = await userFromToken(bearer(req.headers.authorization));
  if (!user) {
    res.status(401).set("WWW-Authenticate", 'Bearer realm="brim-ap"').json({ jsonrpc: "2.0", error: { code: -32001, message: "Send a personal access token: Authorization: Bearer brim_…" }, id: null });
    return;
  }
  if (!user.organization_id) {
    res.status(403).json({ jsonrpc: "2.0", error: { code: -32003, message: "Agents work for organization users; Brim employees use the website." }, id: null });
    return;
  }
  const server = serverFor(user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await auditChannel.run("agent", () => transport.handleRequest(req, res, req.body));
});

// No sessions, so no event stream to open or session to end.
const notAllowed = (_req: unknown, res: import("express").Response) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
mcp.get("/", notAllowed);
mcp.delete("/", notAllowed);
