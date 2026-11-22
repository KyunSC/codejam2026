export const taxNumber = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

export function vendorName(s: string | null | undefined) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\blimited\b/g, "ltd")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// A vendor name without case, punctuation or the company suffix ("Inc", "Ltd", "LLP").
export const nameKey = (s: string | null | undefined) => vendorName(s).replace(/ (inc|ltd|llp)$/, "");

// The number of single-letter insertions, deletions and substitutions that turn one text into the other.
export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// How many letters two names may differ by and still be the same name: one per 8 letters of the longer, none under 5 letters.
export const allowedEdits = (a: string, b: string) => {
  const n = Math.max(a.length, b.length);
  return n < 5 ? 0 : Math.max(1, Math.floor(n / 8));
};

// Two vendor names that are the same once case, punctuation and the suffix are ignored, give or take a few letters.
export function sameName(a: string | null | undefined, b: string | null | undefined) {
  const ka = nameKey(a);
  const kb = nameKey(b);
  return !!ka && !!kb && levenshtein(ka, kb) <= allowedEdits(ka, kb);
}

// Whether a name appears inside a longer text, give or take a few letters: the closest stretch of the text of the name's length.
export function containsName(text: string | null | undefined, name: string | null | undefined) {
  const t = nameKey(text);
  const k = nameKey(name);
  if (!t || !k) return false;
  const allowed = allowedEdits(k, k);
  for (let i = 0; i <= Math.max(0, t.length - k.length); i++) {
    if (i > 0 && t[i - 1] !== " ") continue;
    for (const len of [k.length - allowed, k.length, k.length + allowed]) {
      if (len > 0 && levenshtein(t.slice(i, i + len), k) <= allowed) return true;
    }
  }
  return false;
}

// Invoice number without case, punctuation or leading zeros: INV-001 → INV001, 000903 → 903.
export const invoiceNumberKey = (s: string | null | undefined) => (s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "") : "");

// Invoice number with prefix letters, punctuation, leading zeros and a trailing letter dropped: FA-000583 → 583, 000903-A → 903.
export function invoiceNumberCore(s: string | null | undefined) {
  if (!s) return "";
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[A-Z]+/, "")
    .replace(/[A-Z]$/, "")
    .replace(/^0+/, "");
}

export const descriptionKey = (s: string) => s.toLowerCase().replace(/[0-9]+([.,][0-9]+)?%?/g, "#").replace(/\s+/g, " ").trim();

export function words(s: string) {
  return new Set(descriptionKey(s).split(/[^a-z#]+/).filter((w) => w.length > 2));
}

export function similarity(a: string, b: string) {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function provinceFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = addr.toUpperCase().match(/\b(ON|BC|AB|QC|MB|SK|NS|NB|NL|PE)\b(?=\s+[A-Z]\d[A-Z])/) ?? addr.toUpperCase().match(/\b(ON|BC|AB|QC|MB|SK|NS|NB|NL|PE)\b/);
  return m ? m[1] : null;
}
