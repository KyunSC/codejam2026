/**
 * The checks engine: every check in BUILD_PLAN's table, run in a fixed order.
 * `runChecks(invoice, refs)` is the validate + dedupe stages of the pipeline.
 */
import type { Flag, FlagCode, ResolvedInvoice } from "../../types";
import type { Refs } from "../refs";
import { BANK_CHECKS } from "./bank";
import { CONTRACT_CHECKS } from "./contract";
import { DUP_CHECKS } from "./dupes";
import { EMAIL_CHECKS } from "./email";
import { PEOPLE_CHECKS } from "./people";
import { PO_CHECKS } from "./po";
import { type Check, READING_CHECKS } from "./reading";
import { TAX_CHECKS } from "./tax";
import { VENDOR_CHECKS } from "./vendor";

export type { Check } from "./reading";

/** Every check by flag code, in the order they run (reading first, duplicates last). */
export const ALL_CHECKS: Readonly<Record<string, Check>> = {
  ...READING_CHECKS,
  ...VENDOR_CHECKS,
  ...EMAIL_CHECKS,
  ...BANK_CHECKS,
  ...TAX_CHECKS,
  ...PO_CHECKS,
  ...CONTRACT_CHECKS,
  ...PEOPLE_CHECKS,
  ...DUP_CHECKS,
};

export function runChecks(inv: ResolvedInvoice, refs: Refs, only?: ReadonlyArray<FlagCode>): Flag[] {
  const out: Flag[] = [];
  for (const [code, check] of Object.entries(ALL_CHECKS)) {
    if (only && !only.includes(code as FlagCode)) continue;
    out.push(...check(inv, refs));
  }
  return out;
}

/** Whether any flag stops payment (effect hold). */
export const hasHold = (flags: readonly Flag[]) => flags.some((f) => f.effect === "hold");
