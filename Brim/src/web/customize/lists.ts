import type { Ordered, ResolvedItem, SectionPage, StoredPreferences, TableId } from "@/lib/preferences";

// Where an ordered list lives in the stored document.
export type ListPath =
  | { kind: "tabs" }
  | { kind: "tiles" }
  | { kind: "cards" }
  | { kind: "section"; page: SectionPage }
  | { kind: "columns"; table: TableId };

function storedList(s: StoredPreferences, p: ListPath): Ordered | undefined {
  switch (p.kind) {
    case "tabs": return s.tabs;
    case "tiles": return s.dashboard?.tiles;
    case "cards": return s.dashboard?.cards;
    case "section": return s.sections?.[p.page];
    case "columns": return s.tables?.[p.table]?.columns;
  }
}

function withList(s: StoredPreferences, p: ListPath, list: Ordered): StoredPreferences {
  switch (p.kind) {
    case "tabs": return { ...s, tabs: list as StoredPreferences["tabs"] };
    case "tiles": return { ...s, dashboard: { ...s.dashboard, tiles: list as NonNullable<StoredPreferences["dashboard"]>["tiles"] } };
    case "cards": return { ...s, dashboard: { ...s.dashboard, cards: list as NonNullable<StoredPreferences["dashboard"]>["cards"] } };
    case "section": return { ...s, sections: { ...s.sections, [p.page]: list } };
    case "columns": return { ...s, tables: { ...s.tables, [p.table]: { ...s.tables?.[p.table], columns: list } } };
  }
}

// The stored list for what the user sees, plus any stored entries they can't see right now (another role's tabs),
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
