import { can, type Action } from "./authz";
import type { User } from "./types";

// Dashboard preferences: which tiles and cards each user shows, and in what order. Shared by the server and the React app
// (the same resolution, so edits show at once). The zod schema for saving is in preferences.schema.ts, so zod stays out of
// the browser bundle. Only what the user changed is stored; resolvePreferences fills in the rest on every read.

export const PREFERENCES_VERSION = 1;

// `action`: the permission that shows the item.
export type Def<Id extends string = string> = { id: Id; label: string; action?: Action };

export const TILE_IDS = ["to_review", "raw_needs", "raw_waiting", "my_approvals", "approved_unscheduled", "to_release", "vendors_pending", "bank_changes"] as const;
export type TileId = (typeof TILE_IDS)[number];

// The dashboard count tiles, in their default order, with the permission each needs.
export const DASHBOARD_TILES: Def<TileId>[] = [
  { id: "to_review", label: "Invoices to review", action: "parsed.review" },
  { id: "raw_needs", label: "Emails needing attention", action: "parsed.review" },
  { id: "raw_waiting", label: "Waiting on a sender", action: "parsed.review" },
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

export type Ordered<Id extends string = string> = { id: Id; visible: boolean }[];
export type StoredPreferences = { dashboard?: { tiles?: Ordered<TileId>; cards?: Ordered<CardId> } };

export const MAX_LIST = 30;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// A stored list with unknown ids, repeats and bad entries dropped.
function cleanOrdered<Id extends string>(v: unknown, ids: readonly string[]): Ordered<Id> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Ordered<Id> = [];
  for (const x of v.slice(0, MAX_LIST)) {
    if (isObj(x) && typeof x.id === "string" && ids.includes(x.id) && typeof x.visible === "boolean" && !out.some((y) => y.id === x.id)) out.push({ id: x.id as Id, visible: x.visible });
  }
  return out;
}

// A stored document with anything no longer valid dropped: ids the dashboard no longer has. It always passes the schema.
export function sanitizePreferences(doc: unknown): StoredPreferences {
  if (!isObj(doc) || !isObj(doc.dashboard)) return {};
  const tiles = cleanOrdered<TileId>(doc.dashboard.tiles, TILE_IDS);
  const cards = cleanOrdered<CardId>(doc.dashboard.cards, CARD_IDS);
  if (!tiles && !cards) return {};
  return { dashboard: { ...(tiles ? { tiles } : {}), ...(cards ? { cards } : {}) } };
}

// Older stored shapes are brought up to the current version here. Version 1 is the first, so this only cleans the document.
export function migratePreferences(doc: unknown, version: number): StoredPreferences {
  void version;
  return sanitizePreferences(doc);
}

export type ResolvedItem<Id extends string = string> = { id: Id; label: string; visible: boolean };
export type ResolvedPreferences = { dashboard: { tiles: ResolvedItem<TileId>[]; cards: ResolvedItem<CardId>[] } };

// One list: the stored order first (known, allowed ids only), then anything it doesn't mention, visible, in default order.
function resolveOrdered<Id extends string>(stored: Ordered<Id> | undefined, defs: Def<Id>[], allowed: (d: Def<Id>) => boolean): ResolvedItem<Id>[] {
  const byId = new Map(defs.filter(allowed).map((d) => [d.id, d]));
  const out: ResolvedItem<Id>[] = [];
  for (const s of stored ?? []) {
    const def = byId.get(s.id);
    if (!def || out.some((o) => o.id === s.id)) continue;
    out.push({ id: def.id, label: def.label, visible: s.visible });
  }
  for (const def of byId.values()) if (!out.some((o) => o.id === def.id)) out.push({ id: def.id, label: def.label, visible: true });
  return out;
}

// The user's dashboard: the stored document over the defaults, limited to what the role can see. Never grants anything.
export function resolvePreferences(storedDoc: StoredPreferences | null | undefined, user: User | null): ResolvedPreferences {
  const stored = sanitizePreferences(storedDoc);
  const allowed = (d: Def) => !d.action || can(user, d.action);
  return {
    dashboard: {
      tiles: resolveOrdered(stored.dashboard?.tiles, DASHBOARD_TILES, allowed),
      cards: resolveOrdered(stored.dashboard?.cards, DASHBOARD_CARDS, allowed),
    },
  };
}
