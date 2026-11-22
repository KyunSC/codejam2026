import { Router } from "express";
import { ValidationError } from "@/lib/errors";
import { getPaymentRecord, listPayments } from "@/services/read.service";
import { preparePayment, releasePayment } from "@/services/payment.service";
import { importStatement } from "@/services/statement.service";
import { pagingOf, param, route } from "../http";

// /api/organizations/:orgId: payments and the bank statement.
export const payments = Router({ mergeParams: true });

payments.get("/payments", route(async ({ user, params, query }) => listPayments(user, params.orgId, { status: param(query, "status"), ...pagingOf(query) }), { gate: "payment.view" }));
// Prepare the payment for an approved invoice.
payments.post("/payments", route(async ({ user, params, body }) => {
  if (!body.invoice_id) throw new ValidationError("invoice_id is required");
  return { id: await preparePayment(user, params.orgId, String(body.invoice_id)) };
}, { gate: "payment.prepare" }));
payments.get("/payments/:id", route(async ({ user, params }) => getPaymentRecord(user, params.orgId, params.id), { gate: "payment.view" }));
payments.post("/payments/:id/release", route(async ({ user, params }) => {
  await releasePayment(user, params.orgId, params.id);
  return getPaymentRecord(user, params.orgId, params.id);
}, { gate: "payment.release" }));
// Imports what the bank reported and settles the payments it confirms.
payments.post("/statement-imports", route(async ({ user }) => importStatement(user), { gate: "payment.reconcile" }));
