import { Router } from "express";
import {
  confirmBankChangeByCallback, createVendor, decideBankChange, deleteVendor, getVendor, listBankChanges, listVendorChoices, listVendors, requestBankChange,
  setVendorStatus, updateVendor, type VendorInput,
} from "@/services/vendor.service";
import { pagingOf, param, route } from "../http";

// /api/organizations/:orgId: vendors and their bank details changes.
export const vendors = Router({ mergeParams: true });

vendors.get("/vendors", route(async ({ user, params, query }) => listVendors(user, params.orgId, { status: param(query, "status"), ...pagingOf(query) }), { gate: "vendor.view" }));
vendors.post("/vendors", route(async ({ user, params, body }) => ({ id: await createVendor(user, params.orgId, body as VendorInput) }), { gate: "vendor.onboard" }));
// Vendor names to pick from, for anyone in the organization.
vendors.get("/vendor-choices", route(async ({ user, params }) => listVendorChoices(user, params.orgId)));
vendors.get("/vendors/:id", route(async ({ user, params }) => getVendor(user, params.orgId, params.id), { gate: "vendor.view" }));
vendors.patch("/vendors/:id", route(async ({ user, params, body }) => {
  await updateVendor(user, params.orgId, params.id, body as VendorInput);
  return getVendor(user, params.orgId, params.id);
}, { gate: "vendor.onboard" }));
vendors.delete("/vendors/:id", route(async ({ user, params }) => deleteVendor(user, params.orgId, params.id), { gate: "vendor.onboard" }));
vendors.post("/vendors/:id/approve", route(async ({ user, params }) => {
  await setVendorStatus(user, params.orgId, params.id, "active");
  return getVendor(user, params.orgId, params.id);
}, { gate: "vendor.approve" }));
vendors.post("/vendors/:id/hold", route(async ({ user, params }) => {
  await setVendorStatus(user, params.orgId, params.id, "on_hold");
  return getVendor(user, params.orgId, params.id);
}, { gate: "vendor.approve" }));

vendors.get("/vendors/:id/bank-changes", route(async ({ user, params }) => listBankChanges(user, params.orgId, { vendorId: params.id }), { gate: "vendor.view" }));
// Bank changes across the organization; ?open=true for the pending or unverified ones.
vendors.get("/bank-changes", route(async ({ user, params, query }) => listBankChanges(user, params.orgId, { open: query.get("open") === "true" }), { gate: "vendor.view" }));
vendors.post("/vendors/:id/bank-changes", route(async ({ user, params, body }) => (
  { id: await requestBankChange(user, params.orgId, params.id, body as Parameters<typeof requestBankChange>[3]) }
), { gate: "bank_change.request" }));
vendors.post("/bank-changes/:id/approve", route(async ({ user, params, body }) => (
  decideBankChange(user, params.orgId, params.id, "approved", !!body.verified_by_callback)
), { gate: "bank_change.approve" }));
vendors.post("/bank-changes/:id/reject", route(async ({ user, params }) => decideBankChange(user, params.orgId, params.id, "rejected", false), { gate: "bank_change.approve" }));
vendors.post("/bank-changes/:id/confirm-callback", route(async ({ user, params }) => confirmBankChangeByCallback(user, params.orgId, params.id), { gate: "bank_change.approve" }));
