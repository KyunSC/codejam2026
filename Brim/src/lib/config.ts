/**
 * Every threshold the rules use, in one place (BUILD_PLAN "Decisions already made").
 * Rules import from here; they never hard-code a number.
 *
 * Approval bands and release limits are seed defaults for the PolicyRule table.
 * At runtime the policy table wins, so an admin edit takes effect without a deploy.
 */
export const config = {
  models: {
    /** Reads each PDF or image. */
    extraction: "claude-sonnet-5-5",
    /** Labels emails that have no attachment. */
    emailLabel: "claude-haiku-5-5",
  },

  approval: {
    /** P01/P02: up to this total (CAD incl. tax) the department manager alone approves. */
    deptManagerMaxCad: 10_000,
    /** P03: above this a controller step is added. */
    controllerAboveCad: 50_000,
    /** P04: above this a CFO step is added. */
    cfoAboveCad: 250_000,
  },

  release: {
    /** P09/P10: finance manager may release up to this; above it, controller only. */
    financeManagerMaxCad: 100_000,
  },

  tolerance: {
    /** Line, subtotal and total arithmetic (ARITHMETIC_*). */
    arithmeticCad: 0.02,
    /** Tax amount vs base x rate (TAX_AMOUNT). */
    taxCad: 0.02,
  },

  duplicates: {
    /** DUP_NEAR: totals within this many dollars. */
    nearTotalTolerance: 1.0,
    /** DUP_CONTENT: invoice dates within this many days. */
    contentDateWindowDays: 3,
    /** DUP_PAID_BY_CARD: card posted from N days before to M days after the invoice date. */
    cardDaysBefore: 5,
    cardDaysAfter: 45,
    /** Card merchant descriptors are the vendor name upper-cased and cut to this length. */
    cardMerchantMaxLen: 22,
  },

  checks: {
    /** SPLIT_SUSPECTED: invoices from one vendor within this many days. */
    splitWindowDays: 5,
    /** BANK_CHANGE_RECENT: bank details changed within this many days before the invoice date. */
    bankChangeRecentDays: 30,
    /** DATE_ODD: invoice dated more than this many days before it was received. */
    dateOddMaxAgeDays: 60,
  },

  payments: {
    referencePrefix: { EFT: "BRIM-EFT-", CARD: "BRIM-VC-", CHEQUE: "BRIM-CHQ-" },
    referenceDigits: 8,
    /** Bank statement description: "EFT PMT " + vendor name cut to this length + last 6 of the reference. */
    statementNameMaxLen: 24,
    /** An EFT account number must have one of these lengths, or the simulated payment fails. */
    eftAccountDigits: [8, 9],
  },
} as const;

export type Config = typeof config;
