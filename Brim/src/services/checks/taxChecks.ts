import { TAX_CODES, codeForLabel, expectedCodes, isGstHst } from "@/lib/taxCodes";
import { round2 } from "@/lib/normalize";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./types";

export async function taxChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d, vendor } = ctx;
  const flags: Flag[] = [];
  const province = d.ship_to_province;
  const foreign = !!vendor && vendor.country !== "CA";
  const exempt = vendor?.category === "Insurance";

  let expGst = 0;
  let expPst = 0;
  const expectedGstCodes = new Set<string>();
  const expectedPstCodes = new Set<string>();
  for (const l of d.lines) {
    const e = expectedCodes(province, l.line_type, { foreign, exempt });
    expectedGstCodes.add(e.gst);
    expGst += l.amount * TAX_CODES[e.gst].rate;
    if (e.pst) {
      expectedPstCodes.add(e.pst);
      expPst += l.amount * TAX_CODES[e.pst].rate;
    }
  }
  expGst = round2(expGst);
  expPst = round2(expPst);

  const charged = d.taxes.map((t) => codeForLabel(t.label)).filter((c) => c);
  const chargedGst = charged.filter((c) => isGstHst(c));
  const chargedPst = charged.filter((c) => c === "PST7_BC" || c === "QST9975");
  const label = (codes: Iterable<string>) => [...codes].filter((c) => c !== "FOREIGN" && c !== "EXEMPT").join(" + ") || "no tax";

  if (foreign && charged.length) {
    flags.push({ check_code: "tax_on_foreign_vendor", category: "tax", severity: "warning", message: `Canadian tax (${label(charged as string[])}) charged by a foreign vendor.` });
    return flags;
  }
  if (!foreign && !exempt && vendor?.gst_hst_number && !charged.length && expGst !== 0) {
    flags.push({
      check_code: "tax_missing",
      category: "tax",
      severity: "warning",
      message: `No tax charged, but ${vendor.legal_name} is GST/HST-registered and the delivery is in ${province ?? "?"}: expected ${label(expectedGstCodes)} of ${money(expGst)}${expPst ? ` and ${label(expectedPstCodes)} of ${money(expPst)}` : ""}.`,
      evidence: { expected: { gst_hst: expGst, pst_qst: expPst }, found: { gst_hst: 0, pst_qst: 0 } },
    });
    return flags;
  }

  const gstWrongCode = chargedGst.some((c) => !expectedGstCodes.has(c!));
  const pstWrongCode = chargedPst.some((c) => !expectedPstCodes.has(c!)) || (expPst !== 0 && !chargedPst.length);
  if (gstWrongCode || pstWrongCode) {
    flags.push({
      check_code: "tax_wrong_code",
      category: "tax",
      severity: "warning",
      message: `Charged ${label(charged as string[])}; a delivery to ${province ?? "?"} calls for ${label([...expectedGstCodes, ...expectedPstCodes])}.`,
      evidence: { expected: [...expectedGstCodes, ...expectedPstCodes], found: charged },
    });
  }
  const gotGst = round2(d.gst_hst_amount ?? 0);
  const gotPst = round2(d.pst_qst_amount ?? 0);
  if (!gstWrongCode && Math.abs(gotGst - expGst) > 0.02 * Math.max(1, d.lines.length)) {
    flags.push({ check_code: "tax_amount_gst", category: "tax", severity: "warning", message: `GST/HST charged ${money(gotGst)}; expected ${money(expGst)}.`, evidence: { expected: expGst, found: gotGst } });
  }
  if (!pstWrongCode && Math.abs(gotPst - expPst) > 0.02 * Math.max(1, d.lines.length)) {
    flags.push({ check_code: "tax_amount_pst", category: "tax", severity: "warning", message: `PST/QST charged ${money(gotPst)}; expected ${money(expPst)}.`, evidence: { expected: expPst, found: gotPst } });
  }
  return flags;
}
