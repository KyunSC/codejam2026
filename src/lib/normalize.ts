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
