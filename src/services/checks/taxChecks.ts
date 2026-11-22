import { TAX_CODES, codeForLabel, expectedCodes, isGstHst, type TaxCode } from "@/lib/taxCodes";
import { round2 } from "@/lib/normalize";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./types";

// The tax an invoice should carry, line by line, from where it was delivered and whether each line is goods or services:
// none from a foreign vendor, an exempt one (Insurance) or one with no GST/HST number. Then two checks: the tax charged
// corresponds to the territory (tax), and the amounts are what the rates give (math).
export async function taxChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor } = ctx;
  const flags: Flag[] = [];
  const province = d.ship_to_province;
  const foreign = !!vendor && vendor.country !== "CA";
  const exempt = vendor?.category === "Insurance";
  const unregistered = !!vendor && !foreign && !vendor.gst_hst_number;
  const charged = d.taxes.map((t) => codeForLabel(t.label)).filter((c): c is TaxCode => !!c);
  const label = (codes: Iterable<string>) => [...new Set(codes)].filter((c) => c !== "FOREIGN" && c !== "EXEMPT").join(" + ") || "no tax";
  const none = foreign || exempt || unregistered;

  // without the delivery province the expected tax is unknown
  if (!none && !province) {
    flags.push({ check_code: "tax_province_unknown", category: "tax", severity: "warning", message: `The delivery province is not known, so the tax charged (${label(charged)}) is not compared.` });
    return flags;
  }

  let expGst = 0;
  let expPst = 0;
  const expected = new Set<TaxCode>();
  if (!none) {
    for (const l of d.lines) {
      const e = expectedCodes(province, l.line_type, { foreign: false, exempt: false });
      expected.add(e.gst);
      expGst += l.amount * TAX_CODES[e.gst].rate;
      if (e.pst) {
        expected.add(e.pst);
        expPst += l.amount * TAX_CODES[e.pst].rate;
      }
    }
  }
  expGst = round2(expGst);
  expPst = round2(expPst);

  // the tax charged corresponds to the territory: the same kinds of tax, none missing and none extra
  const missing = [...expected].filter((c) => !charged.includes(c));
  const extra = charged.filter((c) => !expected.has(c));
  if (missing.length || extra.length) {
    const why = foreign ? `${vendor!.legal_name} is a foreign vendor, so no Canadian tax applies`
      : exempt ? `${vendor!.legal_name} is in the Insurance category, so its supplies are exempt`
      : unregistered ? `${vendor!.legal_name} has no GST/HST number, so it charges no tax`
      : `a delivery to ${province} is taxed with ${label(expected)}`;
    flags.push({
      check_code: "tax_territory_mismatch",
      category: "tax",
      severity: "blocking",
      message: `Charged ${label(charged)}; ${why}.`,
      evidence: { expected: [...expected], found: charged },
    });
  }

  // the amounts, for the kinds of tax that correspond
  const tolerance = 0.02 * Math.max(1, d.lines.length);
  const gotGst = round2(d.gst_hst_amount ?? 0);
  const gotPst = round2(d.pst_qst_amount ?? 0);
  const gstMatches = !charged.some((c) => isGstHst(c) && !expected.has(c));
  const pstMatches = !charged.some((c) => !isGstHst(c) && !expected.has(c));
  if (charged.some(isGstHst) && gstMatches && Math.abs(gotGst - expGst) > tolerance) {
    flags.push({ check_code: "tax_amount_gst", category: "math", severity: "warning", message: `GST/HST charged ${money(gotGst)}; the rates give ${money(expGst)}.`, evidence: { expected: expGst, found: gotGst } });
  }
  if (charged.some((c) => !isGstHst(c)) && pstMatches && Math.abs(gotPst - expPst) > tolerance) {
    flags.push({ check_code: "tax_amount_pst", category: "math", severity: "warning", message: `PST/QST charged ${money(gotPst)}; the rates give ${money(expPst)}.`, evidence: { expected: expPst, found: gotPst } });
  }
  return flags;
}
