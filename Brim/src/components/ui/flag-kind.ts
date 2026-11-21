import type { Flag, FlagCode } from "@/lib/types";

/**
 * How a flag looks: one of six chip colours. This is presentation only; the checks engine
 * decides whether a flag exists and what it says.
 */
export type FlagKind = "fraud" | "duplicate" | "tax" | "split" | "over-po" | "check" | "clean";

export const FLAG_KIND_LABEL: Record<FlagKind, string> = {
  fraud: "Fraud",
  duplicate: "Duplicate",
  tax: "Tax",
  split: "Split",
  "over-po": "Over PO",
  check: "Check",
  clean: "Clean",
};

/** The chip and card-shadow colour for each kind, as a CSS value. */
export const FLAG_KIND_COLOR: Record<FlagKind, string> = {
  fraud: "var(--red)",
  duplicate: "var(--gold)",
  tax: "var(--pink)",
  split: "var(--purple)",
  "over-po": "var(--blue)",
  check: "var(--shadow)",
  clean: "var(--green)",
};

export function flagKind(flag: Pick<Flag, "code" | "klass">): FlagKind {
  if (flag.klass === "fraud") return "fraud";
  return kindForCode(flag.code);
}

export function kindForCode(code: FlagCode): FlagKind {
  if (code.startsWith("DUP_")) return "duplicate";
  if (code.startsWith("TAX_")) return "tax";
  if (code === "SPLIT_SUSPECTED") return "split";
  if (code.startsWith("PO_") || code.startsWith("CONTRACT_")) return "over-po";
  if (code.startsWith("BANK_") || code.startsWith("SENDER_") || code === "VENDOR_LOOKALIKE") return "fraud";
  return "check";
}

/** Order for "worst first" sorting. */
export const FLAG_KIND_RANK: Record<FlagKind, number> = {
  fraud: 0,
  duplicate: 1,
  tax: 2,
  split: 3,
  "over-po": 4,
  check: 5,
  clean: 6,
};
