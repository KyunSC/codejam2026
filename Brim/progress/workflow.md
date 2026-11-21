# Loop C: workflow, payments, vendors, audit

Branch `loop/workflow`. One item per run. Notes under each item.

Local env for every command (never Neon): `BRIM_LOCAL_DB_ONLY=1 DATABASE_URL=postgresql://localhost:5432/brim DATABASE_URL_UNPOOLED=<same> APP_TODAY=2026-11-02`. The shell's values win over `.env` because dotenv never overrides.

- [x] 1. Local setup green: npm install, prisma generate, migrations + seed on local DB, ingest-inbox --run, test/typecheck pass.
  - No local Postgres existed on this machine; installed `postgresql@17` with Homebrew (`brew services start postgresql@17`), databases `brim` and `brim_test`.
  - `.env` points at Neon. `npm test` loads `.env`, so running tests without the local overrides above would point the DB tests (which `deleteMany` inside a rolled-back transaction) at Neon. Always export the local vars first.
  - `npm install` skipped the Prisma postinstall (npm install-scripts approval); run `npx prisma generate` by hand.
  - `ANTHROPIC_API_KEY` in `.env` is empty, so ingest used the hand-made answers (`fixtures/extracted`). 41 drafts extracted, 4 emails labelled.
  - 44 test files / 928 tests pass; typecheck and lint clean. No failing tests.
- [x] 2. Single guarded invoice status transition (status machine, heldFrom, version lock) with audit row in the same transaction; replace direct status writes.
  - `src/lib/invoices/transition.ts`: `STATUS_MACHINE`, `canTransition` (pure), `transitionInvoice(tx, …)` (status + version lock, `heldFrom`, audit row), `bumpInvoiceVersion` for edits that keep the status. run.ts now moves drafts through it; no other code wrote an invoice status (intake/seed only create rows).
  - Surprise: `logAction` did not hash-chain app rows (only the seed chained history rows), and never set `actorRole`. It now takes a per-organization advisory lock, links to the last hashed row, sets `actorRole`, `paymentId`, `vendorId`. Test proves the stored JSONB round-trips through `verifyChain`.
  - Local DB reset at the user's request (migrate reset, seed, ingest --run): 971 audit rows, all hashed, chain verifies end to end.
  - New DB tests use `src/lib/workflow-test/local-db.ts`: they run only when DATABASE_URL is localhost, never against Neon.
- [x] 3. processInvoice service: resolve → runChecks → Flag rows → coding on lines → status via transition. Called from run.ts and POST .../invoices/[id]/process. Intake audit rows (invoice.receive, email.label). Compare 41 drafts with "Unsealed batch: expected".
  - `src/lib/workflow/refs.ts` `loadLiveRefs`: dataset tables for what the app never edits; vendors (status, live bank account), bank change requests, users (status, delegate, manager), policy rules and known invoices from the DB. Users keep dataset ids (`externalId`), matching history's ApprovalStep rows.
  - `src/lib/workflow/process.ts` `processInvoice`: flags keep their resolution on re-run (overridden/confirmed stay), stale open flags become `fixed`; lines get `glSuggested`, `departmentSuggested`, `lineType`, `reason` (account reason, source, department reason); `glFinal` never overwritten. Status `needs_review` while a hold flag is open or a line has no account, else `coded`. Audit action `invoice.checked` via the transition.
  - run.ts calls it in the same transaction as the extraction commit. `POST /api/orgs/[slug]/invoices/[id]/process` (AP clerk, matrix `invoice.edit`). `src/lib/workflow/guard.ts` maps the session user to the matrix actor and throws its code.
  - Intake already wrote `invoice.received` / `email.received`; added `email.label` rows (model labels and the rule label from the attachment's document type).
  - `scripts/process-inbox.ts` re-runs and prints file → vendor, status, open flags (`*` = hold). Result on the 41 drafts matches "Unsealed batch: expected" for every file, with three differences:
    1. `riverbendcaterin_1739` also raised `TAX_WRONG_FOR_PROVINCE` (hold): an unregistered supplier charging no tax. Fixed in `checks/tax.ts` with a failing table test first; `TAX_NOT_REGISTERED` (info) covers it. History replay unchanged.
    2. `SPLIT_SUSPECTED` fires only on the last of the three Orion invoices (`Invoice 287.pdf`); the first two were checked before the third existed. By design (checks only look at earlier invoices); the flag's evidence lists all three.
    3. `cloudbarnsoftwar_INV01561` raises `DUP_CONTENT` against AP-00411 (scheduled, same fixed fee, one day apart) besides the expected `DUP_EXACT` with AP-00370. Both hold a real duplicate; left as is.
  - Surprise: with the audit-chain lock, DB test files running in parallel deadlocked on long rollback transactions. `vitest.config.mts` now sets `fileParallelism: false` (suite 33 s).
- [ ] 4. Invoice screen: flags as sentences + resolve action, field evidence marks, line coding + reason, accept/override via PATCH If-Match.
- [ ] 5. Approvals: submit, route-preview, approve/reject, delegation, chain on invoice screen, "Waiting for me"; five worked examples pass against the DB.
- [ ] 6. Payments: prepare, release, simulate bank run, invoice follows payment, dashboard; day-one state.
- [ ] 7. Vendors: list/detail, onboarding, approve/hold/release-hold (FOUR_EYES), bank changes verify/reject (CALLBACK_REQUIRED); V004 held until BC-009 verified.
- [ ] 8. Audit: pack per payment, global log filters, CSV export (auditor read-only server-side), verify chain.
- [ ] 9. Navigation and landing pages per role; every route checks the matrix server-side.
- [ ] 10. Policy editor for the controller with "Try on an invoice" preview (LOCKED_RULE, BAD_CONDITION).
- [ ] 11. Fraud watch page; sender domain flags shown; open fraud flag blocks release.
- [ ] 12. Bank reconciliation per BUILD_PLAN Bonus; "Mark explained" audited.
