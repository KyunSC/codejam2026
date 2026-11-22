import { can, type Action } from "./authz";
import type { User } from "./types";

// Workspace preferences: what each user can customize, the shape stored in user_preferences.prefs,
// and how a stored document resolves against the defaults and the user's role.
// Shared by the server and the React app (the same resolution, so edits show at once). The zod schema for
// saving is in preferences.schema.ts, so zod stays out of the browser bundle.
// Only what the user changed is stored; resolvePreferences fills in the rest on every read.

export const PREFERENCES_VERSION = 1;

// ---------- what can be customized ----------

// `action`: the permission that shows the item; with a list, any one of them does.
export type Def<Id extends string = string> = { id: Id; label: string; action?: Action | Action[]; locked?: boolean };

export const TAB_IDS = ["dashboard", "invoices", "purchase_orders", "payments", "vendors", "account", "settings"] as const;
export type TabId = (typeof TAB_IDS)[number];
export type TabDef = Def<TabId> & { href: string; match: string };

// The workspace tabs, in their default order (as App.tsx listed them). `action` is the permission that shows the tab.
// Settings shows when the user may open any settings page: users, approval policies or the audit log.
export const TABS: TabDef[] = [
  { id: "dashboard", label: "Dashboard", href: "/dashboard", match: "/dashboard", locked: true },
  { id: "invoices", label: "Invoices", href: "/invoices", match: "/invoices" },
  { id: "purchase_orders", label: "Purchase orders", href: "/purchase-orders", match: "/purchase-orders" },
  { id: "payments", label: "Payments", href: "/payments", match: "/payments", action: "payment.view" },
  { id: "vendors", label: "Vendors", href: "/vendors", match: "/vendors", action: "vendor.view" },
  { id: "account", label: "Account", href: "/account", match: "/account" },
  { id: "settings", label: "Settings", href: "/settings", match: "/settings", action: ["users.manage", "policies.manage", "audit.view"] },
];

export const TILE_IDS = ["raw_failed", "my_approvals", "approved_unscheduled", "to_release", "vendors_pending", "bank_changes"] as const;
export type TileId = (typeof TILE_IDS)[number];

// The dashboard count tiles, as the dashboard shows them today, with the permission each needs.
export const DASHBOARD_TILES: Def<TileId>[] = [
  { id: "raw_failed", label: "Documents that could not be read", action: "raw.extract" },
  { id: "my_approvals", label: "Waiting for your approval", action: "approval.act" },
  { id: "approved_unscheduled", label: "Approved, not yet scheduled", action: "payment.prepare" },
  { id: "to_release", label: "Payments to release", action: "payment.release" },
  { id: "vendors_pending", label: "Vendors pending approval", action: "vendor.approve" },
  { id: "bank_changes", label: "Bank changes pending", action: "vendor.approve" },
];

export const CARD_IDS = ["pending", "spend", "delegate"] as const;
export type CardId = (typeof CARD_IDS)[number];

export const DASHBOARD_CARDS: Def<CardId>[] = [
  { id: "pending", label: "Pending approval" },
  { id: "spend", label: "Spend by department" },
  { id: "delegate", label: "Away? Delegate your approvals", action: "delegate.set" },
];

// Page sections that can be moved or hidden.
export const SECTIONS = {
  invoices: [
    { id: "raw", label: "Raw" },
    { id: "parsed", label: "Parsed" },
    { id: "invoices", label: "Invoices" },
  ],
  payments: [
    { id: "ready", label: "Ready to pay" },
    { id: "list", label: "Payments", locked: true },
  ],
} satisfies Record<string, Def[]>;
export type SectionPage = keyof typeof SECTIONS;

export type TableDef = {
  columns: Def[]; // the first column is locked: it holds the row's id or link
  filters?: { values: readonly string[]; default: string };
  pageSizes?: { values: readonly number[]; default: number };
};

const cols = (...c: [string, string][]): Def[] => c.map(([id, label], i) => ({ id, label, ...(i === 0 ? { locked: true } : {}) }));

// The customizable tables, with column ids from today's table headings. Trailing action columns
// (Extract, Release, …) stay last in the page and aren't listed here.
export const TABLES = {
  raw: {
    columns: cols(["id", "Raw item"], ["kind", "Kind"], ["from", "From / file"], ["received", "Received"], ["status", "Status"]),
    filters: { values: ["all", "email", "pdf", "form"], default: "all" },
    pageSizes: { values: [5, 10, 20], default: 5 },
  },
  parsed: {
    columns: cols(["id", "Parsed"], ["vendor", "Vendor"], ["number", "Invoice #"], ["date", "Date"], ["total", "Total"], ["flags", "Flags"]),
    pageSizes: { values: [5, 10, 20], default: 5 },
  },
  invoices: {
    columns: cols(["id", "Invoice"], ["vendor", "Vendor"], ["number", "Invoice #"], ["date", "Date"], ["total", "Total"], ["department", "Department"], ["status", "Status"], ["waiting_on", "Waiting on"]),
    filters: { values: ["all", "pending_approval", "approved", "scheduled", "paid", "rejected"], default: "all" },
    pageSizes: { values: [5, 10, 20], default: 5 },
  },
  payments: {
    columns: cols(["id", "Payment"], ["invoice", "Invoice"], ["vendor", "Vendor"], ["method", "Method"], ["amount", "Amount"], ["scheduled", "Scheduled"], ["paid", "Paid"], ["prepared_released", "Prepared / released"], ["status", "Status"]),
    filters: { values: ["scheduled", "released", "outstanding", "settled", "all"], default: "scheduled" },
  },
  vendors: {
    columns: cols(["vendor", "Vendor"], ["category", "Category"], ["location", "Location"], ["gst_hst", "GST/HST"], ["pays_by", "Pays by"], ["invoices", "Invoices"], ["status", "Status"], ["warnings", "Warnings"]),
    filters: { values: ["all", "active", "pending_review", "on_hold"], default: "all" },
  },
  audit: {
    columns: cols(["id", "#"], ["when", "When"], ["who", "Who"], ["action", "Action"], ["on", "On"], ["links", "Links"], ["note", "Note"]),
    pageSizes: { values: [20, 50, 100], default: 20 },
  },
} satisfies Record<string, TableDef>;
export type TableId = keyof typeof TABLES;
export const TABLE_IDS = Object.keys(TABLES) as TableId[];
export const tableDef = (t: TableId): TableDef => TABLES[t];

// The pages "Reset this page" knows about, and the stored keys each one owns.
export type PageId = "dashboard" | "invoices" | "payments" | "vendors" | "audit";
const PAGE_KEYS: Record<PageId, { dashboard?: true; sections?: SectionPage[]; tables?: TableId[] }> = {
  dashboard: { dashboard: true },
  invoices: { sections: ["invoices"], tables: ["raw", "parsed", "invoices"] },
  payments: { sections: ["payments"], tables: ["payments"] },
  vendors: { tables: ["vendors"] },
  audit: { tables: ["audit"] },
};

export const THEMES = ["system", "light", "dark"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const ACCENTS = ["red", "blue", "green", "purple", "gold"] as const;
export const TEXT_SIZES = ["normal", "large"] as const;

// ---------- the stored document ----------

export type Ordered<Id extends string = string> = { id: Id; visible: boolean }[];
export type TablePrefs = { columns?: Ordered; filter?: string; pageSize?: number };
export type StoredPreferences = {
  theme?: (typeof THEMES)[number];
  density?: (typeof DENSITIES)[number];
  accent?: (typeof ACCENTS)[number];
  textSize?: (typeof TEXT_SIZES)[number];
  landingPage?: TabId;
  tabs?: Ordered<TabId>;
  dashboard?: { tiles?: Ordered<TileId>; cards?: Ordered<CardId> };
  sections?: { [P in SectionPage]?: Ordered };
  tables?: { [T in TableId]?: TablePrefs };
};

export const MAX_LIST = 30;

// Every setting at its default, written out in full.
export const DEFAULT_PREFERENCES: Required<Omit<StoredPreferences, "dashboard" | "sections" | "tables">> & {
  dashboard: Required<NonNullable<StoredPreferences["dashboard"]>>;
  sections: Record<SectionPage, Ordered>;
  tables: Record<TableId, TablePrefs>;
} = {
  theme: "system",
  density: "comfortable",
  accent: "red",
  textSize: "normal",
  landingPage: "dashboard",
  tabs: TABS.map((d) => ({ id: d.id, visible: true })),
  dashboard: { tiles: DASHBOARD_TILES.map((d) => ({ id: d.id, visible: true })), cards: DASHBOARD_CARDS.map((d) => ({ id: d.id, visible: true })) },
  sections: Object.fromEntries(Object.entries(SECTIONS).map(([p, defs]) => [p, defs.map((d) => ({ id: d.id, visible: true }))])) as Record<SectionPage, Ordered>,
  tables: Object.fromEntries(
    TABLE_IDS.map((t) => {
      const d = tableDef(t);
      return [t, { columns: d.columns.map((c) => ({ id: c.id, visible: true })), ...(d.filters ? { filter: d.filters.default } : {}), ...(d.pageSizes ? { pageSize: d.pageSizes.default } : {}) }];
    }),
  ) as Record<TableId, TablePrefs>,
};

// ---------- reading stored documents leniently ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);

function cleanOrdered<Id extends string>(v: unknown, ids: readonly string[]): Ordered<Id> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Ordered<Id> = [];
  for (const x of v.slice(0, MAX_LIST)) {
    if (isObj(x) && typeof x.id === "string" && ids.includes(x.id) && typeof x.visible === "boolean" && !out.some((y) => y.id === x.id)) out.push({ id: x.id as Id, visible: x.visible });
  }
  return out;
}

const compact = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// A stored document with anything no longer valid dropped: ids the app no longer has, values it no longer allows.
// The result always passes preferencesSchema, so the app can edit it and save it back.
export function sanitizePreferences(doc: unknown): StoredPreferences {
  if (!isObj(doc)) return {};
  const out: StoredPreferences = compact({
    theme: oneOf(doc.theme, THEMES),
    density: oneOf(doc.density, DENSITIES),
    accent: oneOf(doc.accent, ACCENTS),
    textSize: oneOf(doc.textSize, TEXT_SIZES),
    landingPage: oneOf(doc.landingPage, TAB_IDS),
    tabs: cleanOrdered<TabId>(doc.tabs, TAB_IDS),
  });
  if (isObj(doc.dashboard)) {
    const d = compact({ tiles: cleanOrdered<TileId>(doc.dashboard.tiles, TILE_IDS), cards: cleanOrdered<CardId>(doc.dashboard.cards, CARD_IDS) });
    if (Object.keys(d).length) out.dashboard = d;
  }
  if (isObj(doc.sections)) {
    const s: NonNullable<StoredPreferences["sections"]> = {};
    for (const [p, defs] of Object.entries(SECTIONS) as [SectionPage, Def[]][]) {
      const list = cleanOrdered(doc.sections[p], defs.map((x) => x.id));
      if (list) s[p] = list;
    }
    if (Object.keys(s).length) out.sections = s;
  }
  if (isObj(doc.tables)) {
    const tables: NonNullable<StoredPreferences["tables"]> = {};
    for (const t of TABLE_IDS) {
      const v = doc.tables[t];
      if (!isObj(v)) continue;
      const d = tableDef(t);
      const tp: TablePrefs = compact({
        columns: cleanOrdered(v.columns, d.columns.map((c) => c.id)),
        filter: d.filters ? oneOf(v.filter, d.filters.values) : undefined,
        pageSize: d.pageSizes && typeof v.pageSize === "number" && d.pageSizes.values.includes(v.pageSize) ? v.pageSize : undefined,
      });
      if (Object.keys(tp).length) tables[t] = tp;
    }
    if (Object.keys(tables).length) out.tables = tables;
  }
  return out;
}

// Older stored shapes are brought up to the current version here. Version 1 is the first, so this only cleans the document.
export function migratePreferences(doc: unknown, version: number): StoredPreferences {
  void version;
  return sanitizePreferences(doc);
}

// ---------- resolution ----------

export type ResolvedItem<Id extends string = string> = { id: Id; label: string; visible: boolean; locked: boolean };
export type ResolvedTab = ResolvedItem<TabId> & { href: string; match: string };
export type ResolvedTable = { columns: ResolvedItem[]; filter: string | null; pageSize: number | null };
export type ResolvedPreferences = {
  theme: (typeof THEMES)[number];
  density: (typeof DENSITIES)[number];
  accent: (typeof ACCENTS)[number];
  textSize: (typeof TEXT_SIZES)[number];
  landingPage: TabId;
  tabs: ResolvedTab[];
  dashboard: { tiles: ResolvedItem<TileId>[]; cards: ResolvedItem<CardId>[] };
  sections: Record<SectionPage, ResolvedItem[]>;
  tables: Record<TableId, ResolvedTable>;
};

// One list: the stored order first (known, allowed ids only), then anything the stored order doesn't mention,
// visible, in default order. Locked items are always visible and keep their default position.
function resolveOrdered<D extends Def>(stored: Ordered | undefined, defs: D[], allowed: (d: D) => boolean): (Omit<D, "locked" | "action"> & { visible: boolean; locked: boolean })[] {
  const usable = defs.filter(allowed);
  const byId = new Map(usable.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const free: { def: D; visible: boolean }[] = [];
  for (const s of stored ?? []) {
    const def = byId.get(s.id);
    if (!def || seen.has(s.id) || def.locked) continue;
    seen.add(s.id);
    free.push({ def, visible: s.visible });
  }
  for (const def of usable) if (!seen.has(def.id) && !def.locked) free.push({ def, visible: true });
  const out = free.map(({ def, visible }) => ({ def, visible }));
  usable.forEach((def, i) => {
    if (def.locked) out.splice(Math.min(i, out.length), 0, { def, visible: true });
  });
  return out.map(({ def, visible }) => {
    const { locked, action, ...rest } = def;
    void action;
    return { ...rest, visible, locked: !!locked };
  });
}

// The full set of preferences for a user: the stored document over the defaults, limited to what the role can open.
// Never grants anything: it only hides or orders what can() already allows.
export function resolvePreferences(storedDoc: StoredPreferences | null | undefined, user: User | null): ResolvedPreferences {
  const stored = sanitizePreferences(storedDoc);
  const allowed = (d: Def) => !d.action || (Array.isArray(d.action) ? d.action.some((a) => can(user, a)) : can(user, d.action));
  const tabs = resolveOrdered(stored.tabs, TABS, allowed) as ResolvedTab[];
  const landing = tabs.find((t) => t.id === stored.landingPage && t.visible);
  return {
    theme: stored.theme ?? DEFAULT_PREFERENCES.theme,
    density: stored.density ?? DEFAULT_PREFERENCES.density,
    accent: stored.accent ?? DEFAULT_PREFERENCES.accent,
    textSize: stored.textSize ?? DEFAULT_PREFERENCES.textSize,
    landingPage: landing ? landing.id : "dashboard",
    tabs,
    dashboard: {
      tiles: resolveOrdered(stored.dashboard?.tiles, DASHBOARD_TILES, allowed),
      cards: resolveOrdered(stored.dashboard?.cards, DASHBOARD_CARDS, allowed),
    },
    sections: Object.fromEntries(
      (Object.entries(SECTIONS) as [SectionPage, Def[]][]).map(([p, defs]) => [p, resolveOrdered(stored.sections?.[p], defs, () => true)]),
    ) as Record<SectionPage, ResolvedItem[]>,
    tables: Object.fromEntries(
      TABLE_IDS.map((t) => {
        const d = tableDef(t);
        const s = stored.tables?.[t];
        return [t, {
          columns: resolveOrdered(s?.columns, d.columns, () => true),
          filter: d.filters ? (s?.filter ?? d.filters.default) : null,
          pageSize: d.pageSizes ? (s?.pageSize ?? d.pageSizes.default) : null,
        }];
      }),
    ) as Record<TableId, ResolvedTable>,
  };
}

// The stored document without one page's settings: what "Reset this page" saves.
export function resetPage(stored: StoredPreferences, page: PageId): StoredPreferences {
  const keys = PAGE_KEYS[page];
  const next: StoredPreferences = structuredClone(stored);
  if (keys.dashboard) delete next.dashboard;
  for (const p of keys.sections ?? []) delete next.sections?.[p];
  for (const t of keys.tables ?? []) delete next.tables?.[t];
  if (next.sections && !Object.keys(next.sections).length) delete next.sections;
  if (next.tables && !Object.keys(next.tables).length) delete next.tables;
  return next;
}
