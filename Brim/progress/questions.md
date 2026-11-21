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
