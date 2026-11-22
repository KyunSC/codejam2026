import { Router } from "express";
import { ValidationError } from "@/lib/errors";
import { getPaymentRecord, listPayments, paymentTotals } from "@/services/read.service";
import { preparePayment, releasePayment } from "@/services/payment.service";
import { runBankSimulation } from "@/services/bankSimulator.service";
import { pagingOf, param, route } from "../http";

// /api/organizations/:orgId: payments and the bank simulation.
export const payments = Router({ mergeParams: true });

payments.get("/payments", route(async ({ user, params, query }) => listPayments(user, params.orgId, { status: param(query, "status"), ...pagingOf(query) }), { gate: "payment.view" }));
// Prepare the payment for an approved invoice.
payments.post("/payments", route(async ({ user, params, body }) => {
  if (!body.invoice_id) throw new ValidationError("invoice_id is required");
  return { id: await preparePayment(user, params.orgId, String(body.invoice_id)) };
}, { gate: "payment.prepare" }));
// Count and CAD total of the payments in each status.
payments.get("/payments/totals", route(async ({ user, params }) => paymentTotals(user, params.orgId), { gate: "payment.view" }));
payments.get("/payments/:id", route(async ({ user, params }) => getPaymentRecord(user, params.orgId, params.id), { gate: "payment.view" }));
payments.post("/payments/:id/release", route(async ({ user, params }) => {
  await releasePayment(user, params.orgId, params.id);
  return getPaymentRecord(user, params.orgId, params.id);
}, { gate: "payment.release" }));
// Sends every released payment to the simulated bank.
payments.post("/bank-runs", route(async ({ user }) => runBankSimulation(user), { gate: "payment.simulate" }));
