# Open questions (Loop A)

Decisions not covered by BUILD_PLAN.md, with the option picked. Newest last.

- **Local database port (1.1).** The loop file says Docker on 5433, but `.env` points at Postgres.app on `localhost:5432` (database `brim`). It is local, so the guard accepts it; I used it as is.
- **Where uploaded file bytes live (1.1).** BUILD_PLAN says Vercel Blob. Picked: `Document.data` (bytea) plus `Document.url`, so the loop runs with no Blob store; dataset files use `url = dataset:incoming_invoices/<name>`. Blob can fill `url` later without a schema change.
