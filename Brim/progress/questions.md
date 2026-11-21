# Open questions (Loop A)

Decisions not covered by BUILD_PLAN.md, with the option picked. Newest last.

- **Local database port (1.1).** The loop file says Docker on 5433, but `.env` points at Postgres.app on `localhost:5432` (database `brim`). It is local, so the guard accepts it; I used it as is.
- **Where uploaded file bytes live (1.1).** BUILD_PLAN says Vercel Blob. Picked: `Document.data` (bytea) plus `Document.url`, so the loop runs with no Blob store; dataset files use `url = dataset:incoming_invoices/<name>`. Blob can fill `url` later without a schema change.
- **Policy types location (1.2).** Loop B builds routing and may define its own `Condition`/`Effect`. Picked: appended BUILD_PLAN's shapes to `src/lib/types.ts` (the shared contract) with two additions, `{ any: [...] }` for P05's OR and `poPresent` for P13. If Loop B has its own copy, merge onto the types.ts one.
- **V004's live account (1.5).** BUILD_PLAN says the live account changes only when a request is verified, but `vendors.csv` already holds the account from unverified BC-009, and the old full account is unknown (only `7504`). Picked: the CSV account is live, BC-009 is `pending`, and the hold comes from the pending request. Rejecting BC-009 later cannot restore the old account, only its last 4 digits; that path should keep payments held and say why.
- **History payment status `outstanding` (1.6).** BUILD_PLAN's payment states are scheduled/released/sent/settled/failed; the CSV has `outstanding` for 20 mailed cheques. Picked: store them as `sent` (mailed, not cleared). Reconciliation will show all 20 have in fact cleared on the statement.
- **Seeded inbox documents (1.8).** Stored by SHA-256 with `url = dataset:incoming_invoices/<name>` and no bytes in `Document.data`; uploads still go in `data`. Seed creates the emails unlabelled and no draft invoices, leaving that to intake. Picked as the safest: seeding never runs extraction.
