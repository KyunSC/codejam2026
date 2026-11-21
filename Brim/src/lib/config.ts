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
    /** P06: vendor categories that always add a finance manager step. */
    financeReviewCategories: ["Legal"] as readonly string[],
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

  tax: {
    /** Vendor categories whose supplies are exempt in every province (history: all EXEMPT lines). */
    exemptCategories: ["Insurance"] as readonly string[],
  },

  contracts: {
    /** CONTRACT_FUEL_OVER_CAP: the surcharge line, and the shipment lines it is a percentage of (history reproduces the printed % from these). */
    fuelSurchargePattern: /fuel surcharge/i,
    shipmentPattern: /ltl shipment/i,
    /** CONTRACT_RATE_OVER_CAP: a line billed by the hour (besides any line with quantity above 1). */
    hourlyPattern: /\b(hours?|hrs?|hourly)\b/i,
    /** CONTRACT_FUEL_OVER_CAP: percentage points of slack for rounding of the printed surcharge. */
    fuelPctTolerance: 0.01,
  },

  resolution: {
    /** Vendor step 2: a bank-account match also needs names at least this similar (word overlap, 0–1). */
    bankNameMinSimilarity: 0.5,
    /** VENDOR_UNKNOWN: how many closest names to offer, and the least similarity worth offering. */
    candidateCount: 3,
    candidateMinSimilarity: 0.2,
  },

  checks: {
    /** SPLIT_SUSPECTED: invoices from one vendor within this many days. */
    splitWindowDays: 5,
    /** BANK_CHANGE_RECENT: bank details changed within this many days before the invoice date. */
    bankChangeRecentDays: 30,
    /** DATE_ODD: invoice dated more than this many days before it was received. */
    dateOddMaxAgeDays: 60,
    /**
     * VENDOR_LOOKALIKE: "little history" means at most this many known invoices. The lookalike records in
     * the dataset have 0, 2 and 3 invoices; the records they imitate have 4 to 12.
     */
    lookalikeMaxHistory: 3,
    /**
     * SENDER_LOOKALIKE_DOMAIN: a sender domain whose name is within this many edits of a vendor's domain name,
     * or contains a vendor's domain name at least `lookalikeDomainMinNameLen` letters long, without being it.
     * Over the vendor master this pairs only V052's harlowandstern-llp.example with V026's harlow.example.
     */
    lookalikeDomainMaxEdits: 2,
    lookalikeDomainMinNameLen: 4,
  },

  reconciliation: {
    /**
     * A cleared cheque with no payment of the exact amount may match the earliest unmatched cheque within this
     * many dollars, shown as "amount differs by $x". History: one at $6,990.53 against $6,990.48.
     */
    chequeAmountTolerance: 0.25,
    /**
     * An EFT line whose reference matches but whose amount is off by at most this much still matches, noted.
     * History: BK-00121, BK-00190 and BK-00230 are each one cent off their payment.
     */
    eftAmountTolerance: 0.05,
    /** Bank fee lines (MONTHLY ACCOUNT FEE, WIRE FEE) are explained to this GL account. */
    feeAccount: "7010",
  },

  payments: {
    referencePrefix: { EFT: "BRIM-EFT-", CARD: "BRIM-VC-", CHEQUE: "BRIM-CHQ-" },
    referenceDigits: 8,
    /** Bank statement description: "EFT PMT " + vendor name cut to this length + last 6 of the reference. */
    statementNameMaxLen: 24,
    /** An EFT account number must have one of these lengths, or the simulated payment fails. */
    // Widened so `.includes(account.length)` type-checks; `as const` would make it `readonly [8, 9]`.
    eftAccountDigits: [8, 9] as readonly number[],
    /** Simulated references: this base plus the payment number, as the 8 digits after the prefix. */
    referenceBase: 90_000_000,
    /** Dashboard "due this week": due within this many days of today. */
    dueSoonDays: 7,
  },
} as const;

export type Config = typeof config;
