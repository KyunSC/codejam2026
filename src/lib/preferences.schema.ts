import { z } from "zod";
import { ACCENTS, CARD_IDS, DENSITIES, MAX_LIST, SECTIONS, TAB_IDS, TABLE_IDS, TEXT_SIZES, THEMES, TILE_IDS, tableDef, type TableDef } from "./preferences";

// What PUT /api/me/preferences accepts, built from the definitions in preferences.ts.
// Server side only (and the check script): the browser never validates, so zod stays out of its bundle.

// A list of { id, visible } with known ids, at most 30 entries, duplicates dropped (the first one wins).
function orderedSchema(ids: readonly string[]) {
  return z
    .array(z.object({ id: z.string().refine((id) => ids.includes(id), { message: `must be one of: ${ids.join(", ")}` }), visible: z.boolean() }).strict())
    .max(MAX_LIST)
    .transform((list) => list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i));
}

function tableSchema(t: TableDef) {
  return z
    .object({
      columns: orderedSchema(t.columns.map((c) => c.id)).optional(),
      ...(t.filters ? { filter: z.enum(t.filters.values as [string, ...string[]]).optional() } : {}),
      ...(t.pageSizes ? { pageSize: z.number().refine((n) => t.pageSizes!.values.includes(n), { message: `must be one of: ${t.pageSizes.values.join(", ")}` }).optional() } : {}),
    })
    .strict();
}

// What PUT /api/me/preferences accepts. Unknown top-level keys are dropped; unknown ids and values inside are refused.
export const preferencesSchema = z.object({
  theme: z.enum(THEMES).optional(),
  density: z.enum(DENSITIES).optional(),
  accent: z.enum(ACCENTS).optional(),
  textSize: z.enum(TEXT_SIZES).optional(),
  landingPage: z.enum(TAB_IDS).optional(),
  tabs: orderedSchema(TAB_IDS).optional(),
  dashboard: z.object({ tiles: orderedSchema(TILE_IDS).optional(), cards: orderedSchema(CARD_IDS).optional() }).strict().optional(),
  sections: z
    .object(Object.fromEntries(Object.entries(SECTIONS).map(([p, defs]) => [p, orderedSchema(defs.map((d) => d.id)).optional()])))
    .strict()
    .optional(),
  tables: z
    .object(Object.fromEntries(TABLE_IDS.map((t) => [t, tableSchema(tableDef(t)).optional()])))
    .strict()
    .optional(),
});
