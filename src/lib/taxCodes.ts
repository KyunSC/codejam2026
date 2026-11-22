export type TaxCode = "HST13" | "GST5" | "PST7_BC" | "QST9975" | "EXEMPT" | "FOREIGN";

export const TAX_CODES: Record<TaxCode, { rate: number; goodsOnly: boolean; recoverable: boolean; gl: string | null }> = {
  HST13: { rate: 0.13, goodsOnly: false, recoverable: true, gl: "1160" },
  GST5: { rate: 0.05, goodsOnly: false, recoverable: true, gl: "1160" },
  PST7_BC: { rate: 0.07, goodsOnly: true, recoverable: false, gl: null },
  QST9975: { rate: 0.09975, goodsOnly: false, recoverable: true, gl: "1165" },
  EXEMPT: { rate: 0, goodsOnly: false, recoverable: false, gl: null },
  FOREIGN: { rate: 0, goodsOnly: false, recoverable: false, gl: null },
};

// The codes that should apply to a line delivered to a province.
export function expectedCodes(
  province: string | null | undefined,
  lineType: "goods" | "services" | null | undefined,
  opts: { foreign: boolean; exempt: boolean },
): { gst: TaxCode; pst: TaxCode | null } {
  if (opts.foreign) return { gst: "FOREIGN", pst: null };
  if (opts.exempt) return { gst: "EXEMPT", pst: null };
  switch (province) {
    case "ON":
      return { gst: "HST13", pst: null };
    case "BC":
      return { gst: "GST5", pst: lineType === "goods" ? "PST7_BC" : null };
    case "QC":
      return { gst: "GST5", pst: "QST9975" };
    default:
      return { gst: "GST5", pst: null };
  }
}

// Map a tax line printed on an invoice (English or French) to a code.
export function codeForLabel(label: string): TaxCode | null {
  const l = label.toUpperCase();
  if (l.includes("HST") || l.includes("TVH")) return "HST13";
  if (l.includes("QST") || l.includes("TVQ")) return "QST9975";
  if (l.includes("PST")) return "PST7_BC";
  if (l.includes("GST") || l.includes("TPS")) return "GST5";
  return null;
}

export function isGstHst(code: TaxCode | null) {
  return code === "HST13" || code === "GST5";
}
