# Brim AP

An Express API (`src/server`) and a React app built with Vite (`src/web`) over Postgres. The schema is `db/schema.sql`, queried with `pg` (no ORM). Read `README.md` first for layout and setup. `PLAN.md` and `BUILD_PLAN.md` were written for the earlier Next.js/Prisma version: their business rules still apply, their file paths and tooling do not. Code freeze is **Sunday 2026-11-22, 12:00pm**: working end to end beats a refactor.

## Sealed invoices: do not open

`brim_ap_dataset/sealed_invoices.txt` lists 15 incoming files held back as a stand-in for the judges' hidden batch. Never open, read, extract or print those files, or the emails in `brim_ap_dataset/inbox/emails.json` that carry them, until the team runs the sealed drill. Develop against the other 41 files only. Reading the list itself is fine.

## Design rules

- The LLM only reads documents (extraction). Rules code makes every decision.
- For "today" in a rule, use `AS_OF_DATE` (the dataset's as-of date, 2026-11-02), never `new Date()`.
- Every mutation writes its audit row in the same DB transaction (`writeAudit` inside `tx`). Audit rows are never updated or deleted.
- The React app reaches the server only through `/api`. Routes check the role, then call a service; business rules and permissions live in `src/services`.

## Settings and database

- Settings come from `.env.local` (copy `.env.example`). The server exits at startup if a required one is missing.
- Use a local Postgres. `./scripts/reset-db.sh` drops and recreates the database named in `DATABASE_URL` from `db/schema.sql` and empties `storage/`. Never point it, or destructive SQL, at a shared database.
- Never commit `.env.local` or other secrets.

## Before calling work done

Run from `Brim/`, and report failures as they are (there are no automated tests yet):

```bash
npm run typecheck
npm run lint
npm run build
```
