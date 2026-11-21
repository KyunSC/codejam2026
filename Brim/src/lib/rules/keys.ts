/**
 * Keys used to compare invoice numbers and vendor names (BUILD_PLAN Normalisation, Resolution).
 * Pure string functions, shared by resolution, duplicate detection and the history adapter.
 */

/** Upper case, letters and digits only, no leading zeros. `FA-001655` → `FA001655`, `000604` → `604`. */
export function numberKey(printed: string | null | undefined): string | null {
  if (!printed) return null;
  const k = printed.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  return k || null;
}

/** Digits only, no leading zeros. `FA-001655` → `1655`, `1655-A` → `1655`. */
export function digitsKey(printed: string | null | undefined): string | null {
  if (!printed) return null;
  const k = printed.replace(/\D/g, "").replace(/^0+/, "");
  return k || null;
}

const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "ltd", "limited", "llp", "co", "corp", "corporation", "llc"]);

/**
 * Lower case, accents and punctuation removed, `&` → `and`, legal suffixes dropped.
 * `Harlow & Stern LLP` and `Harlow and Stern LLP` both become `harlow and stern`.
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Word-overlap similarity (Jaccard) of two normalised names, 0 to 1. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const wa = new Set(normalizeName(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

/** Tax or bank numbers compared on letters and digits only, upper case. */
export function idKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const k = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return k || null;
}

/** Card merchant descriptor as the card network prints it: upper case, cut to `maxLen`. */
export function merchantDescriptor(name: string, maxLen: number): string {
  return name.toUpperCase().slice(0, maxLen).trim();
}
