import { Router } from "express";
import { auditCsv, auditFilterOptions, auditInvoicePage, auditPage, filterFrom } from "@/services/audit.service";
import { pagingOf, route } from "../http";

// /api/organizations/:orgId: the audit log.
export const audit = Router({ mergeParams: true });

// Filters: invoice, actor, action. 20 per page.
audit.get("/audit-events", route(async ({ user, params, query }) => auditPage(user, params.orgId, filterFrom(query), pagingOf(query)), { gate: "audit.view" }));
// Choices for the filters: the first invoices by recent activity, the people who acted, the actions taken.
audit.get("/audit-events/filters", route(async ({ user, params }) => auditFilterOptions(user, params.orgId), { gate: "audit.view" }));
// Invoice IDs by most recent audit activity, 20 at a time from ?offset=.
audit.get("/audit-events/invoices", route(async ({ user, params, query }) => auditInvoicePage(user, params.orgId, Number(query.get("offset") ?? 0) || 0), { gate: "audit.view" }));
// The audit log as CSV, with the same filters as the list.
audit.get("/audit-events/export", route(async ({ res, user, params, query }) => {
  const csv = await auditCsv(user, params.orgId, filterFrom(query));
  res.set({ "content-type": "text/csv", "content-disposition": 'attachment; filename="audit.csv"' }).send(csv);
}, { gate: "audit.view" }));
