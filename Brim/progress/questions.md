# Loop B questions

Open points for the team. Loop B takes BUILD_PLAN's version and moves on.

- **ResolvedInvoice has no invoice id.** Checks that need the invoice's own approvals or payments (e.g.
  SELF_APPROVAL in the history replay) read it from `refs.self.invoiceId` instead. If Loop A wants it on
  the type, append `invoiceId: string | null` to `ResolvedInvoice`; Loop B will switch to it.
