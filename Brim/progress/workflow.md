# Loop C: workflow, payments, vendors, audit

Branch `loop/workflow`. One item per run. Notes under each item.

Local env for every command (never Neon): `BRIM_LOCAL_DB_ONLY=1 DATABASE_URL=postgresql://localhost:5432/brim DATABASE_URL_UNPOOLED=<same> APP_TODAY=2026-11-02`. The shell's values win over `.env` because dotenv never overrides.

- [x] 1. Local setup green: npm install, prisma generate, migrations + seed on local DB, ingest-inbox --run, test/typecheck pass.
  - No local Postgres existed on this machine; installed `postgresql@17` with Homebrew (`brew services start postgresql@17`), databases `brim` and `brim_test`.
  - `.env` points at Neon. `npm test` loads `.env`, so running tests without the local overrides above would point the DB tests (which `deleteMany` inside a rolled-back transaction) at Neon. Always export the local vars first.
  - `npm install` skipped the Prisma postinstall (npm install-scripts approval); run `npx prisma generate` by hand.
  - `ANTHROPIC_API_KEY` in `.env` is empty, so ingest used the hand-made answers (`fixtures/extracted`). 41 drafts extracted, 4 emails labelled.
  - 44 test files / 928 tests pass; typecheck and lint clean. No failing tests.
- [ ] 2. Single guarded invoice status transition (status machine, heldFrom, version lock) with audit row in the same transaction; replace direct status writes.
- [ ] 3. processInvoice service: resolve → runChecks → Flag rows → coding on lines → status via transition. Called from run.ts and POST .../invoices/[id]/process. Intake audit rows (invoice.receive, email.label). Compare 41 drafts with "Unsealed batch: expected".
- [ ] 4. Invoice screen: flags as sentences + resolve action, field evidence marks, line coding + reason, accept/override via PATCH If-Match.
- [ ] 5. Approvals: submit, route-preview, approve/reject, delegation, chain on invoice screen, "Waiting for me"; five worked examples pass against the DB.
- [ ] 6. Payments: prepare, release, simulate bank run, invoice follows payment, dashboard; day-one state.
- [ ] 7. Vendors: list/detail, onboarding, approve/hold/release-hold (FOUR_EYES), bank changes verify/reject (CALLBACK_REQUIRED); V004 held until BC-009 verified.
- [ ] 8. Audit: pack per payment, global log filters, CSV export (auditor read-only server-side), verify chain.
- [ ] 9. Navigation and landing pages per role; every route checks the matrix server-side.
- [ ] 10. Policy editor for the controller with "Try on an invoice" preview (LOCKED_RULE, BAD_CONDITION).
- [ ] 11. Fraud watch page; sender domain flags shown; open fraud flag blocks release.
- [ ] 12. Bank reconciliation per BUILD_PLAN Bonus; "Mark explained" audited.
