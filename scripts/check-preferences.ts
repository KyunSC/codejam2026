// Checks for src/lib/preferences.ts: resolution, validation, sanitizing, page reset. No database.
// Run: npx tsx scripts/check-preferences.ts
import assert from "node:assert/strict";
import type { Role, User } from "@/lib/types";
import {
  DEFAULT_PREFERENCES, TABLES, resetPage, resolvePreferences, sanitizePreferences, type StoredPreferences,
} from "@/lib/preferences";
import { preferencesSchema } from "@/lib/preferences.schema";

const person = (role: Role): User => ({
  user_id: "U-CHECK", organization_id: "ORG-CHECK", full_name: "Check Person", email: "check@example.com", title: null, department_id: null,
  manager_id: null, role, approval_limit_cad: 0, work_province: null, status: "active", status_since: null, delegate_user_id: null,
});
const controller = person("controller_admin");
const clerk = person("ap_clerk");
const employee = person("employee");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const visibleIds = (xs: { id: string; visible: boolean }[]) => xs.filter((x) => x.visible).map((x) => x.id);

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`ok  ${name}`);
}

check("empty document resolves to the defaults", () => {
  const r = resolvePreferences({}, controller);
  assert.equal(r.theme, "system");
  assert.equal(r.density, "comfortable");
  assert.equal(r.landingPage, "dashboard");
  assert.deepEqual(ids(r.tabs), ["dashboard", "invoices", "purchase_orders", "payments", "vendors", "account", "settings"]);
  assert.ok(r.tabs.every((t) => t.visible));
  assert.equal(r.tables.payments.filter, "scheduled");
  assert.equal(r.tables.invoices.pageSize, 5);
  assert.equal(r.tables.audit.pageSize, 20);
  assert.equal(r.tables.vendors.pageSize, null);
  assert.equal(r.tables.parsed.filter, null);
  assert.deepEqual(resolvePreferences(null, controller), r);
});

check("tabs the role can't open are left out, whatever is stored", () => {
  const r = resolvePreferences({ tabs: [{ id: "settings", visible: true }, { id: "payments", visible: true }] }, clerk);
  assert.deepEqual(ids(r.tabs), ["dashboard", "payments", "invoices", "purchase_orders", "vendors", "account"]);
  assert.deepEqual(ids(resolvePreferences({}, employee).tabs), ["dashboard", "invoices", "purchase_orders", "account"]);
  // Settings shows for any one of its pages' permissions: the auditor has only the audit log
  assert.ok(ids(resolvePreferences({}, person("auditor")).tabs).includes("settings"));
});

check("stored order wins, and ids the stored order doesn't mention are appended visible", () => {
  const r = resolvePreferences({ tabs: [{ id: "vendors", visible: true }, { id: "invoices", visible: false }] }, controller);
  assert.deepEqual(ids(r.tabs), ["dashboard", "vendors", "invoices", "purchase_orders", "payments", "account", "settings"]);
  assert.deepEqual(visibleIds(r.tabs), ["dashboard", "vendors", "purchase_orders", "payments", "account", "settings"]);
});

check("unknown ids in a stored document are ignored", () => {
  const stored = { tabs: [{ id: "reports", visible: true }, { id: "settings", visible: false }], tables: { raw: { columns: [{ id: "colour", visible: true }] } } };
  const r = resolvePreferences(stored as unknown as StoredPreferences, controller);
  assert.ok(!ids(r.tabs).includes("reports" as never));
  assert.equal(r.tabs.find((t) => t.id === "settings")!.visible, false);
  assert.deepEqual(ids(r.tables.raw.columns), ids(TABLES.raw.columns));
});

check("locked items stay visible and in place", () => {
  const r = resolvePreferences({
    tabs: [{ id: "settings", visible: true }, { id: "dashboard", visible: false }],
    tables: { invoices: { columns: [{ id: "status", visible: true }, { id: "id", visible: false }] } },
    sections: { payments: [{ id: "list", visible: false }, { id: "ready", visible: false }] },
  }, controller);
  assert.equal(r.tabs[0].id, "dashboard");
  assert.equal(r.tabs[0].visible, true);
  assert.equal(r.tabs[0].locked, true);
  assert.equal(r.tables.invoices.columns[0].id, "id");
  assert.equal(r.tables.invoices.columns[0].visible, true);
  assert.equal(r.tables.invoices.columns[1].id, "status");
  assert.deepEqual(r.sections.payments.map((s) => [s.id, s.visible]), [["ready", false], ["list", true]]);
});

check("a hidden or forbidden landing page falls back to the dashboard", () => {
  assert.equal(resolvePreferences({ landingPage: "invoices" }, clerk).landingPage, "invoices");
  assert.equal(resolvePreferences({ landingPage: "invoices", tabs: [{ id: "invoices", visible: false }] }, clerk).landingPage, "dashboard");
  assert.equal(resolvePreferences({ landingPage: "settings" }, clerk).landingPage, "dashboard");
  assert.equal(resolvePreferences({ landingPage: "settings" }, controller).landingPage, "settings");
});

check("a column the stored order doesn't know (added to the app later) is appended visible", () => {
  const stored: StoredPreferences = { tables: { invoices: { columns: [{ id: "id", visible: true }, { id: "total", visible: true }, { id: "vendor", visible: false }] } } };
  const r = resolvePreferences(stored, controller);
  assert.deepEqual(ids(r.tables.invoices.columns), ["id", "total", "vendor", "number", "date", "department", "status", "waiting_on"]);
  assert.equal(r.tables.invoices.columns.find((c) => c.id === "vendor")!.visible, false);
});

check("an invalid stored filter or page size falls back to the table default", () => {
  const r = resolvePreferences({ tables: { invoices: { filter: "archived", pageSize: 7 }, payments: { filter: "released" } } } as unknown as StoredPreferences, controller);
  assert.equal(r.tables.invoices.filter, "all");
  assert.equal(r.tables.invoices.pageSize, 5);
  assert.equal(r.tables.payments.filter, "released");
});

check("dashboard tiles and cards follow the role", () => {
  assert.deepEqual(ids(resolvePreferences({}, clerk).dashboard.tiles), ["raw_failed", "approved_unscheduled"]);
  assert.deepEqual(ids(resolvePreferences({}, controller).dashboard.tiles), ["my_approvals", "to_release", "vendors_pending", "bank_changes"]);
  assert.deepEqual(ids(resolvePreferences({}, clerk).dashboard.cards), ["pending", "spend"]);
  assert.deepEqual(ids(resolvePreferences({}, controller).dashboard.cards), ["pending", "spend", "delegate"]);
});

check("the schema accepts a valid document and drops duplicate ids", () => {
  const r = preferencesSchema.safeParse({ theme: "dark", tabs: [{ id: "settings", visible: false }, { id: "settings", visible: true }], tables: { invoices: { pageSize: 10, filter: "paid" } } });
  assert.ok(r.success);
  assert.deepEqual(r.data.tabs, [{ id: "settings", visible: false }]);
  assert.ok(preferencesSchema.safeParse({}).success);
  assert.ok(preferencesSchema.safeParse(DEFAULT_PREFERENCES).success, "the full defaults are a valid document");
});

check("the schema refuses bad values and names the field", () => {
  const bad = (doc: unknown, path: string) => {
    const r = preferencesSchema.safeParse(doc);
    assert.ok(!r.success, `expected ${JSON.stringify(doc)} to be refused`);
    assert.equal(r.error.issues[0].path.join("."), path);
  };
  bad({ theme: "neon" }, "theme");
  bad({ tables: { invoices: { pageSize: 7 } } }, "tables.invoices.pageSize");
  bad({ tables: { vendors: { pageSize: 10 } } }, "tables.vendors");
  bad({ tables: { parsed: { filter: "all" } } }, "tables.parsed");
  bad({ tables: { payments: { filter: "archived" } } }, "tables.payments.filter");
  bad({ tabs: [{ id: "reports", visible: true }] }, "tabs.0.id");
  bad({ landingPage: "reports" }, "landingPage");
  bad({ tabs: Array.from({ length: 31 }, () => ({ id: "settings", visible: true })) }, "tabs");
});

check("unknown top-level keys are dropped, not refused", () => {
  const r = preferencesSchema.safeParse({ theme: "light", favouriteColour: "teal" });
  assert.ok(r.success);
  assert.deepEqual(r.data, { theme: "light" });
});

check("sanitize keeps what is valid and drops the rest, and its result passes the schema", () => {
  const messy = {
    theme: "neon", density: "compact", tabs: [{ id: "settings", visible: false }, { id: "reports", visible: true }, "junk"],
    tables: { invoices: { pageSize: 7, filter: "paid", columns: [{ id: "status", visible: false }] }, vendors: { pageSize: 10 }, nope: {} },
    sections: { invoices: "x" }, dashboard: { tiles: [{ id: "raw_failed", visible: false }] },
  };
  const clean = sanitizePreferences(messy);
  assert.deepEqual(clean, {
    density: "compact", tabs: [{ id: "settings", visible: false }],
    dashboard: { tiles: [{ id: "raw_failed", visible: false }] },
    tables: { invoices: { filter: "paid", columns: [{ id: "status", visible: false }] } },
  });
  assert.ok(preferencesSchema.safeParse(clean).success);
  assert.deepEqual(sanitizePreferences("nonsense"), {});
});

check("resetPage removes only that page's settings", () => {
  const stored: StoredPreferences = {
    theme: "dark",
    dashboard: { cards: [{ id: "spend", visible: false }] },
    sections: { invoices: [{ id: "invoices", visible: true }], payments: [{ id: "ready", visible: false }] },
    tables: { raw: { pageSize: 10 }, payments: { filter: "all" } },
  };
  assert.deepEqual(resetPage(stored, "invoices"), { theme: "dark", dashboard: stored.dashboard, sections: { payments: stored.sections!.payments }, tables: { payments: { filter: "all" } } });
  assert.deepEqual(resetPage(stored, "dashboard"), { theme: "dark", sections: stored.sections, tables: stored.tables });
  assert.deepEqual(resetPage({ tables: { audit: { pageSize: 50 } } }, "audit"), {});
  assert.equal(stored.tables!.raw!.pageSize, 10, "the input is not changed");
});

console.log(`\n${n} checks passed`);
