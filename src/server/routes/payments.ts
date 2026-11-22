import { Router } from "express";
import { ValidationError } from "@/lib/errors";
import { getPaymentRecord, listPayments } from "@/services/read.service";
import { failPayment, preparePayment, releasePayment } from "@/services/payment.service";
import { pagingOf, param, route } from "../http";

// /api/organizations/:orgId: payments.
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
// Marks a released or outstanding payment failed, with the reason; its invoice can then be paid again.
payments.post("/payments/:id/failure", route(async ({ user, params, body }) => {
  await failPayment(user, params.orgId, params.id, String(body.reason ?? ""));
  return getPaymentRecord(user, params.orgId, params.id);
}, { gate: "payment.release" }));
