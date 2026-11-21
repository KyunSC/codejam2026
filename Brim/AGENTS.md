<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Brim AP

Read `README.md` first, then `BUILD_PLAN.md` (rules, contracts, build order). Code freeze is **Sunday 2026-11-22, 12:00pm**: working end to end beats a refactor.

## Sealed invoices: do not open

`brim_ap_dataset/sealed_invoices.txt` lists 15 incoming files held back as a stand-in for the judges' hidden batch. Never open, read, extract or print those files, or the emails in `brim_ap_dataset/inbox/emails.json` that carry them, until the team runs the sealed drill. Develop and seed against the other 41 files only. Reading the list itself is fine.

## Design rules

- The LLM only reads documents (extraction, email labelling). Rules code makes every decision.
- Every threshold lives in `src/lib/config.ts`. Rules never hard-code a number.
- For "today" in a rule, call `today()` from `src/lib/today.ts`, never `new Date()`.
- Every mutation writes its audit row in the same DB transaction. Audit rows are never updated or deleted.
- Invoice status changes go through the single guarded transition function. No direct status writes.
- `src/lib/types.ts` is the pipeline/rules contract. Loop A may append to it; Loop B never edits it.

## Database

- `.env` may point at the shared Neon database. Never run migrations, the seed, or destructive SQL against it.
- Migrations and the seed run only against a local Postgres, with `BRIM_LOCAL_DB_ONLY=1` set.

## Before calling work done

Run from `Brim/`, and report failures as they are:

```bash
npm test
npm run typecheck
npm run lint
```
