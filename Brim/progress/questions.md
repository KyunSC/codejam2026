# Loop B questions

Open points for the team. Loop B takes BUILD_PLAN's version and moves on.

- **ResolvedInvoice has no invoice id.** Checks that need the invoice's own approvals or payments (e.g.
  SELF_APPROVAL in the history replay) read it from `refs.self.invoiceId` instead. If Loop A wants it on
  the type, append `invoiceId: string | null` to `ResolvedInvoice`; Loop B will switch to it.
- **Class/effect for codes not in the Checks table.** Loop B uses DATE_AMBIGUOUS data/hold (the date decides
  due date and FX), FX_RATE_FALLBACK data/info, SHIP_TO_UNKNOWN data/hold (the province decides the tax).
- **FIELD_UNCERTAIN and `not_in_text`.** Only `uncertain`, `unreadable`, `missing` or a null value hold, as
  BUILD_PLAN says. A value that is `not_in_text` does not hold; should it?
- **What counts as "little history" for VENDOR_LOOKALIKE?** Loop B uses: this record has at most 3 known
  invoices and no more than its lookalike. That flags invoices from V051 (3) and V053 (2) in history, plus V052.
- **Bank change: block or info?** PLAN.md says a recent bank change blocks release until verified; BUILD_PLAN
  makes BANK_CHANGE_UNVERIFIED fraud/hold and BANK_CHANGE_RECENT fraud/info (a verified recent change only
  informs). Loop B follows BUILD_PLAN.
- **AP-00388** (V004) was paid on 2026-10-29, two days after V004's unverified bank change (BC-009,
  2026-10-27). Its payment was scheduled on 10-26, so the check does not flag it. Was it paid to the old or
  the new account? Reconciliation may want to show this.
- **SPLIT_SUSPECTED and requester.** BUILD_PLAN says "same vendor"; PLAN.md says "same vendor + requester".
  Loop B requires the same requester when both are known (history then gives exactly the two planted groups;
  vendor alone adds AP-00120, AP-00191 and AP-00303/00304). Unknown requester matches anyone, so the incoming
  three-on-one-day case still fires.
- **SELF_APPROVAL class/effect** as a history finding: Loop B uses fraud/info.
- **P05 as a structured rule.** BUILD_PLAN's conditions are ANDed, so "pending_review or new" is written as
  `flag in [VENDOR_PENDING, VENDOR_NEW]` (the checks state both facts). Fine for the policy editor?
- **No eligible releaser** (worked example 5, and anything over $250,000): Loop B blocks with the reason, as
  BUILD_PLAN decides (Risks 2). Still worth confirming with Brim.
- **Release ordering**: `releaseEligibility` lists finance manager first, then the controller, then the CFO.
