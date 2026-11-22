import type { Ordered, ResolvedItem, StoredPreferences } from "@/lib/preferences";

// Where an ordered list lives in the stored document.
export type ListPath = { kind: "tiles" } | { kind: "cards" };

const storedList = (s: StoredPreferences, p: ListPath): Ordered | undefined => (p.kind === "tiles" ? s.dashboard?.tiles : s.dashboard?.cards);

const withList = (s: StoredPreferences, p: ListPath, list: Ordered): StoredPreferences =>
  ({ ...s, dashboard: { ...s.dashboard, [p.kind]: list } }) as StoredPreferences;

// The stored list for what the user sees, plus any stored entries they can't see right now (another role's tiles),
// so changing one list never forgets those.
function toStored(s: StoredPreferences, p: ListPath, items: { id: string; visible: boolean }[]): Ordered {
  const shown = new Set(items.map((i) => i.id));
  const kept = (storedList(s, p) ?? []).filter((x) => !shown.has(x.id));
  return [...items.map(({ id, visible }) => ({ id, visible })), ...kept];
}

// Save a new order (ids in their new order; ids not given keep their place at the end).
export const reorder = (p: ListPath, items: ResolvedItem[], ids: string[]) => (s: StoredPreferences): StoredPreferences => {
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = [...ids.map((id) => byId.get(id)).filter((i): i is ResolvedItem => !!i), ...items.filter((i) => !ids.includes(i.id))];
  return withList(s, p, toStored(s, p, ordered));
};

// Show or hide one item.
export const setVisible = (p: ListPath, items: ResolvedItem[], id: string, visible: boolean) => (s: StoredPreferences): StoredPreferences =>
  withList(s, p, toStored(s, p, items.map((i) => (i.id === id ? { ...i, visible } : i))));
