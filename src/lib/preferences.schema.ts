import { z } from "zod";
import { CARD_IDS, MAX_LIST, TILE_IDS } from "./preferences";

// What PUT /api/me/preferences accepts. Server side only: the browser never validates, so zod stays out of its bundle.

// A list of { id, visible } with known ids, at most 30 entries, duplicates dropped (the first one wins).
function orderedSchema(ids: readonly string[]) {
  return z
    .array(z.object({ id: z.string().refine((id) => ids.includes(id), { message: `must be one of: ${ids.join(", ")}` }), visible: z.boolean() }).strict())
    .max(MAX_LIST)
    .transform((list) => list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i));
}

// Unknown top-level keys are dropped; unknown ids inside are refused.
export const preferencesSchema = z.object({
  dashboard: z.object({ tiles: orderedSchema(TILE_IDS).optional(), cards: orderedSchema(CARD_IDS).optional() }).strict().optional(),
});
