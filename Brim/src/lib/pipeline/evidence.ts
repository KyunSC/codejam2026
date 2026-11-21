/**
 * Field evidence, computed in code (BUILD_PLAN "Extraction", field evidence table).
 *
 * Text layer: a value is `confirmed` when it appears in the PDF's text layer, `not_in_text`
 * when a text layer exists and it does not.
 * - Text fields are compared as letters and digits only, lower case, so spacing, line breaks
 *   and punctuation do not matter. A value that starts or ends with a digit must not run into
 *   another digit in the text, so `1` is not found inside `2026`.
 * - Numbers (amounts, quantities) are compared by value: every run of one to four adjacent
 *   number-like words in the text is parsed as an amount, and the field's value must be one of
 *   them. So `1,500.00` is found in `1 500,00 $`, and neighbouring columns such as
 *   `10  150.00  1 500,00` do not run together the way they would with spaces removed.
 *
 * Arithmetic: quantity × unit price = amount on each line, lines sum to the subtotal, subtotal
 * plus taxes equals the total, each to the cent. When all three close, every number on the
 * invoice is `confirmed` (this is how a scan's numbers are confirmed).
 *
 * Second read: only for a file with no text layer whose arithmetic does not close. Fields that
 * differ between the reads are `uncertain`; fields both reads agree on are `confirmed`.
 *
 * Fields the model listed as unreadable are `unreadable`; fields not printed are `missing`.
 * A scan's text fields with no second read get no entry: nothing could check them.
 */
import Decimal from "decimal.js";
import type { Extracted, FieldEvidence } from "../types";
import { parseAmount } from "./normalize/amount";

export interface ArithmeticResult {
  /** Per line: true/false, or null when quantity, price or amount is missing. */
  lines: Array<boolean | null>;
  /** Lines sum to the subtotal; null when the subtotal or any line amount is missing. */
  subtotal: boolean | null;
  /** Subtotal plus taxes equals the total; null when either is missing. */
  total: boolean | null;
  /** All three checks ran and passed (every line check that could run passed). */
  closes: boolean;
}

export interface EvidenceResult {
  evidence: Record<string, FieldEvidence>;
  arithmetic: ArithmeticResult;
  /** Required fields that send the invoice to `needs_review`, with why. */
  reviewFields: Array<{ field: string; evidence: FieldEvidence }>;
  needsReview: boolean;
}

/**
 * Fields an invoice cannot be processed without. A required field that is uncertain,
 * unreadable, not in the text layer or missing sends the invoice to review. Any other field
 * that is uncertain or unreadable does too (it is highlighted there); a non-required field
 * that is only `not_in_text` or `missing` does not. The subtotal is not required: a one-line
 * invoice may not print one.
 */
export const REQUIRED_FIELDS = ["vendor.name", "invoiceNumber", "invoiceDate", "total"] as const;

const CENT = new Decimal("0.01");

/** Letters and digits only, lower case, accents kept. */
export function matchKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The text layer, prepared once for many lookups. */
export class TextIndex {
  readonly key: string;
  private readonly numbers = new Set<string>();

  constructor(text: string) {
    this.key = matchKey(text);
    const words = text.split(/\s+/).filter((w) => w !== "");
    const numeric = (w: string) => /\d/.test(w) && /^[-+−(]?[$€]?[\d.,]+[$€]?[)-]?%?$/.test(w.replace(/[:;]$/, ""));
    for (let i = 0; i < words.length; i++) {
      for (let j = i; j < Math.min(words.length, i + 4) && numeric(words[j]); j++) {
        const r = parseAmount(
          words
            .slice(i, j + 1)
            .join(" ")
            .replace(/[:;%]$/, ""),
        );
        if (r?.ok) this.numbers.add(r.value.toString());
      }
    }
  }

  has(value: string, numericField: boolean): boolean {
    if (numericField) {
      const r = parseAmount(value);
      if (r?.ok && this.numbers.has(r.value.toString())) return true;
    }
    return inTextLayer(value, this.key);
  }
}

export function inTextLayer(value: string, textKey: string): boolean {
  const key = matchKey(value);
  if (key === "") return false;
  const digitStart = /^\p{N}/u.test(key);
  const digitEnd = /\p{N}$/u.test(key);
  for (let at = textKey.indexOf(key); at >= 0; at = textKey.indexOf(key, at + 1)) {
    const before = textKey[at - 1];
    const after = textKey[at + key.length];
    if (digitStart && before !== undefined && /\p{N}/u.test(before)) continue;
    if (digitEnd && after !== undefined && /\p{N}/u.test(after)) continue;
    return true;
  }
  return false;
}

/** Every value-bearing field of an extraction, by path. Lists use their index: `lines.0.amount`. */
export function fieldValues(x: Extracted): Map<string, string | null> {
  const m = new Map<string, string | null>([
    ["vendor.name", x.vendor.name],
    ["vendor.address", x.vendor.address],
    ["vendor.gstHstNumber", x.vendor.gstHstNumber],
    ["vendor.qstNumber", x.vendor.qstNumber],
    ["billTo.name", x.billTo.name],
    ["billTo.address", x.billTo.address],
    ["invoiceNumber", x.invoiceNumber],
    ["invoiceDate", x.invoiceDate],
    ["dueDate", x.dueDate],
    ["terms", x.terms],
    ["poNumber", x.poNumber],
    ["creditNoteRef", x.creditNoteRef],
    ["currency", x.currency],
    ["subtotal", x.subtotal],
    ["total", x.total],
    ["remit.institution", x.remit.institution],
    ["remit.transit", x.remit.transit],
    ["remit.account", x.remit.account],
  ]);
  x.lines.forEach((l, i) => {
    m.set(`lines.${i}.description`, l.description);
    m.set(`lines.${i}.quantity`, l.quantity);
    m.set(`lines.${i}.unitPrice`, l.unitPrice);
    m.set(`lines.${i}.amount`, l.amount);
  });
  x.taxes.forEach((t, i) => {
    m.set(`taxes.${i}.label`, t.label);
    m.set(`taxes.${i}.amount`, t.amount);
  });
  return m;
}

function isNumericField(path: string): boolean {
  return /^(subtotal|total|lines\.\d+\.(quantity|unitPrice|amount)|taxes\.\d+\.amount)$/.test(path);
}

function num(raw: string | null): Decimal | null {
  const r = parseAmount(raw);
  return r?.ok ? r.value : null;
}

const closeEnough = (a: Decimal, b: Decimal) => a.minus(b).abs().lte(CENT);

export function checkArithmetic(x: Extracted): ArithmeticResult {
  const lines = x.lines.map((l) => {
    const q = num(l.quantity);
    const p = num(l.unitPrice);
    const a = num(l.amount);
    return q && p && a ? closeEnough(q.times(p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP), a) : null;
  });
  const amounts = x.lines.map((l) => num(l.amount));
  const sub = num(x.subtotal);
  const subtotal =
    sub && amounts.length > 0 && amounts.every((a) => a !== null)
      ? closeEnough(
          amounts.reduce((s: Decimal, a) => s.plus(a!), new Decimal(0)),
          sub,
        )
      : null;
  const taxes = x.taxes.map((t) => num(t.amount));
  const tot = num(x.total);
  const total =
    sub && tot && taxes.every((t) => t !== null)
      ? closeEnough(
          taxes.reduce((s: Decimal, t) => s.plus(t!), sub),
          tot,
        )
      : null;
  const closes = subtotal === true && total === true && lines.every((l) => l !== false);
  return { lines, subtotal, total, closes };
}

function listedUnreadable(path: string, unreadable: string[]): boolean {
  return unreadable.some((u) => u === path || path.startsWith(`${u}.`));
}

export function computeEvidence(
  x: Extracted,
  opts: { textLayer: string | null; hasTextLayer: boolean; secondRead?: Extracted | null },
): EvidenceResult {
  const arithmetic = checkArithmetic(x);
  const text = opts.hasTextLayer && opts.textLayer ? new TextIndex(opts.textLayer) : null;
  const second = !opts.hasTextLayer && !arithmetic.closes && opts.secondRead ? fieldValues(opts.secondRead) : null;

  const evidence: Record<string, FieldEvidence> = {};
  for (const [path, value] of fieldValues(x)) {
    if (listedUnreadable(path, x.unreadable)) evidence[path] = "unreadable";
    else if (value === null || value.trim() === "") evidence[path] = "missing";
    else if (text !== null) {
      const numeric = isNumericField(path);
      evidence[path] = text.has(value, numeric) || (numeric && arithmetic.closes) ? "confirmed" : "not_in_text";
    } else if (isNumericField(path) && arithmetic.closes) evidence[path] = "confirmed";
    else if (second) {
      const other = second.get(path) ?? null;
      evidence[path] = other !== null && matchKey(other) === matchKey(value) ? "confirmed" : "uncertain";
    }
  }
  // Fields the model listed as unreadable that have no value slot (e.g. "lines") still count.
  for (const u of x.unreadable) {
    if (!(u in evidence) && !Object.keys(evidence).some((k) => k.startsWith(`${u}.`))) evidence[u] = "unreadable";
  }

  const reviewFields = REQUIRED_FIELDS.filter((f) => evidence[f] !== undefined && evidence[f] !== "confirmed").map(
    (f) => ({ field: f, evidence: evidence[f] }),
  );
  // Any uncertain or unreadable field anywhere also needs a person (BUILD_PLAN: highlighted in review).
  for (const [field, e] of Object.entries(evidence)) {
    if ((e === "uncertain" || e === "unreadable") && !reviewFields.some((r) => r.field === field)) {
      reviewFields.push({ field, evidence: e });
    }
  }
  return { evidence, arithmetic, reviewFields, needsReview: reviewFields.length > 0 };
}
