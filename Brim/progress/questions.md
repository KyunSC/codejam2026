# Open questions (Loop A)

Decisions not covered by BUILD_PLAN.md, with the option picked. Newest last.

- **Local database port (1.1).** The loop file says Docker on 5433, but `.env` points at Postgres.app on `localhost:5432` (database `brim`). It is local, so the guard accepts it; I used it as is.
- **Where uploaded file bytes live (1.1).** BUILD_PLAN says Vercel Blob. Picked: `Document.data` (bytea) plus `Document.url`, so the loop runs with no Blob store; dataset files use `url = dataset:incoming_invoices/<name>`. Blob can fill `url` later without a schema change.
- **Policy types location (1.2).** Loop B builds routing and may define its own `Condition`/`Effect`. Picked: appended BUILD_PLAN's shapes to `src/lib/types.ts` (the shared contract) with two additions, `{ any: [...] }` for P05's OR and `poPresent` for P13. If Loop B has its own copy, merge onto the types.ts one.
