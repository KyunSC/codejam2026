/**
 * Tax labels as printed → tax code plus the printed rate (BUILD_PLAN "Normalisation", Tax label).
 *
 * `HST`/`TVH` → HST13, `GST`/`TPS` → GST5, `PST`/`TVP` → PST7_BC, `QST`/`TVQ` → QST9975.
 * A combined label (`GST/HST`, `TPS/TVH`) is settled by the printed rate: 13% → HST13,
 * 5% → GST5; with no rate it is TAX_LABEL_UNKNOWN. `Exempt`/`Exonéré` → EXEMPT.
 * The code is what the label says, not what the province should charge: a wrong tax for the
 * province is a check's job, so the label is never "corrected" here.
 */
import Decimal from "decimal.js";
import type { ParseIssue, TaxCode } from "../../types";

export interface TaxLabelResult {
  taxCode: TaxCode | null;
  ratePrinted: Decimal | null;
  issue: ParseIssue | null;
}

const WORDS: Array<[RegExp, TaxCode]> = [
  [/\b(HST|TVH)\b/, "HST13"],
  [/\b(GST|TPS)\b/, "GST5"],
  [/\b(PST|TVP)\b/, "PST7_BC"],
  [/\b(QST|TVQ)\b/, "QST9975"],
];

/** "13%", "13 %", "9,975 %", "9.975%" → 0.13, 0.09975. */
export function printedRate(label: string): Decimal | null {
  const m = /(\d{1,2}(?:[.,]\d{1,4})?)\s*%/.exec(label);
  return m ? new Decimal(m[1].replace(",", ".")).div(100) : null;
}

export function normalizeTaxLabel(label: string, field = "taxes"): TaxLabelResult {
  const plain = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const ratePrinted = printedRate(label);
  const codes = [...new Set(WORDS.filter(([re]) => re.test(plain)).map(([, c]) => c))];

  let taxCode: TaxCode | null = null;
  if (codes.length === 1) taxCode = codes[0];
  else if (codes.length === 2 && codes.includes("HST13") && codes.includes("GST5") && ratePrinted) {
    if (ratePrinted.eq("0.13")) taxCode = "HST13";
    else if (ratePrinted.eq("0.05")) taxCode = "GST5";
  } else if (codes.length === 0 && /\b(EXEMPT|EXONERE|ZERO-RATED|DETAXE)\b/.test(plain)) taxCode = "EXEMPT";

  const issue: ParseIssue | null =
    taxCode === null
      ? {
          field,
          code: "TAX_LABEL_UNKNOWN",
          raw: label,
          detail: codes.length > 1 ? `names more than one tax (${codes.join(", ")})` : "no known tax name",
        }
      : null;
  return { taxCode, ratePrinted, issue };
}
