import { Router } from "express";
import type { Action } from "@/lib/authz";
import {
  createOrganization, createUser, deleteUser, getOrganization, getOrgUser, listOrganizations, listUserChoices, listUsers, updateOrganization, updateUser,
} from "@/services/organization.service";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord, type RecordKind } from "@/services/records.service";
import { departmentSpend } from "@/services/read.service";
import { pagingOf, route } from "../http";

// /api/organizations: the organization list for Brim employees.
export const organizations = Router();
organizations.get("/", route(async ({ user }) => listOrganizations(user), { gate: "org.manage", brim: "org.manage" }));
organizations.post("/", route(async ({ user, body }) => ({ id: await createOrganization(user, body as { legal_name: string }) }), { gate: "org.manage", brim: "org.manage" }));

// /api/organizations/:orgId: the organization, its users and its simple records.
export const organization = Router({ mergeParams: true });

organization.get("/", route(async ({ user, params }) => getOrganization(user, params.orgId)));
organization.patch("/", route(async ({ user, params, body }) => {
  await updateOrganization(user, params.orgId, body);
  return getOrganization(user, params.orgId);
}, { gate: "org.manage", brim: "org.settings" }));

// Invoice spend in CAD by department and month, for the three months up to today.
organization.get("/department-spend", route(async ({ user, params }) => departmentSpend(user, params.orgId)));

organization.get("/users", route(async ({ user, params, query }) => listUsers(user, params.orgId, pagingOf(query))));
// Everyone's name, role and status, for picking a person.
organization.get("/user-choices", route(async ({ user, params }) => listUserChoices(user, params.orgId)));
organization.post("/users", route(async ({ user, params, body }) => ({ id: await createUser(user, params.orgId, body) }), { gate: "users.manage", brim: "users.manage" }));
organization.get("/users/:id", route(async ({ user, params }) => getOrgUser(user, params.orgId, params.id)));
organization.patch("/users/:id", route(async ({ user, params, body }) => {
  await updateUser(user, params.orgId, params.id, body);
  return getOrgUser(user, params.orgId, params.id);
}, { gate: "users.manage", brim: "users.manage" }));
// Marks the user terminated; the records they appear on keep their name.
organization.delete("/users/:id", route(async ({ user, params }) => deleteUser(user, params.orgId, params.id), { gate: "users.manage", brim: "users.manage" }));

// Plain create / read / update / delete records: path, record kind, and the action that may change them.
const RECORDS: [string, RecordKind, Action][] = [
  ["departments", "departments", "org.settings"],
  ["gl-accounts", "gl_accounts", "org.settings"],
  ["contracts", "contracts", "contract.manage"],
  ["purchase-orders", "purchase_orders", "po.manage"],
  ["policies", "approval_policies", "policies.manage"],
];
for (const [path, kind, action] of RECORDS) {
  const gate = { gate: action, brim: action };
  organization.get(`/${path}`, route(async ({ user, params, query }) => listRecords(user, params.orgId, kind, Object.fromEntries(query))));
  organization.post(`/${path}`, route(async ({ user, params, body }) => ({ id: await createRecord(user, params.orgId, kind, body) }), gate));
  organization.get(`/${path}/:id`, route(async ({ user, params }) => getRecord(user, params.orgId, kind, params.id)));
  organization.patch(`/${path}/:id`, route(async ({ user, params, body }) => {
    await updateRecord(user, params.orgId, kind, params.id, body);
    return getRecord(user, params.orgId, kind, params.id);
  }, gate));
  organization.delete(`/${path}/:id`, route(async ({ user, params }) => deleteRecord(user, params.orgId, kind, params.id), gate));
}
