import { round2 } from "@/lib/normalize";
import { money } from "@/lib/format";
import { type CheckContext, type Flag } from "./types";

export async function mathChecks(ctx: CheckContext): Promise<Flag[]> {
  const { data: d } = ctx;
  const flags: Flag[] = [];
  for (const l of d.lines) {
    const expected = round2(l.quantity * l.unit_price);
    if (Math.abs(expected - l.amount) > 0.01) {
      flags.push({
        check_code: "line_math",
        category: "math",
        severity: "blocking",
        line_no: l.line_no,
        message: `Line ${l.line_no}: ${l.quantity} × ${money(l.unit_price)} = ${money(expected)}, but the line shows ${money(l.amount)}.`,
        evidence: { expected, found: l.amount },
      });
    }
  }
  const lineSum = round2(d.lines.reduce((s, l) => s + l.amount, 0));
  if (d.subtotal != null && Math.abs(lineSum - d.subtotal) > 0.01) {
    flags.push({ check_code: "subtotal_math", category: "math", severity: "blocking", message: `Lines add up to ${money(lineSum)}, but the subtotal shows ${money(d.subtotal)}.`, evidence: { expected: lineSum, found: d.subtotal } });
  }
  const taxSum = round2(d.taxes.reduce((s, t) => s + t.amount, 0));
  if (d.subtotal != null && d.total != null) {
    const expected = round2(d.subtotal + taxSum);
    if (Math.abs(expected - d.total) > 0.01) {
      flags.push({ check_code: "total_math", category: "math", severity: "blocking", message: `Subtotal ${money(d.subtotal)} + taxes ${money(taxSum)} = ${money(expected)}, but the total shows ${money(d.total)}.`, evidence: { expected, found: d.total } });
    }
  }
  return flags;
}
