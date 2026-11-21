# Brim AP

Harborline Logistics accounts payable, from inbox to simulated payment. CodeJam 16.

- What to build and why: `PLAN.md`
- Exact rules, contracts and build order: `BUILD_PLAN.md`
- Overnight loop prompts: `loops/`

## Setup

```bash
npm install            # also generates the Prisma client
cp .env.example .env   # fill in DATABASE_URL; ANTHROPIC_API_KEY is optional for the loops
npm run dev
```

Node 20.19 or later.

## Scripts

| Command | Does |
| -- | -- |
| `npm run dev` | Start the app |
| `npm test` | Run Vitest once (loads `.env`, pins `APP_TODAY=2026-11-02`) |
| `npm run script -- scripts/x.ts` | Run a script with `.env` loaded and `APP_TODAY` defaulting to 2026-11-02 |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create and apply a migration. Loop A only, local DB (run with `BRIM_LOCAL_DB_ONLY=1`) |
| `npm run script -- scripts/seed-harborline.ts` | Create Harborline and its 40 dataset users, each with the demo password (`SEED_PASSWORD`, default `harborline`) |
| `npm run script -- scripts/create-brim-staff.ts <email> "<name>" <password>` | Add a Brim staff login for `/admin` |

## Logging in

- Customers log in at `/login` with email and password. New people use `/signup` with their organization's ID; a controller/admin approves them in Settings.
- Harborline users after the seed: any dataset email, e.g. `jordan.okafor@harborline-logistics.example` (AP clerk) or `marcus.webb@harborline-logistics.example` (controller/admin), password `harborline`.
- Brim staff log in from the footer link (`/admin/login`) to onboard and manage organizations. Scripts can call `/api/admin/*` with `Authorization: Bearer $BRIM_ADMIN_TOKEN` instead.
- `.env` needs `SESSION_SECRET` (signs the login cookies) and `BRIM_ADMIN_TOKEN`.

## Harborline pipeline

Run `BRIM_LOCAL_DB_ONLY=1 npm run db:seed` after applying the migrations locally. The import reuses Harborline logins and runs once per organization. Repeating it preserves invoices, passwords, and audit history. The development inbox is `brim_ap_dataset/inbox/emails.open.json`, containing the 44 open messages. Run `npm run script -- scripts/ingest-inbox.ts --run` to process their attachments.

## Shared code

| File | Owner | Rule |
| -- | -- | -- |
| `src/lib/types.ts` | both | The pipeline/rules contract. Loop A may append; Loop B never edits |
| `src/lib/config.ts` | both | Every threshold. Rules never hard-code a number |
| `src/lib/dataset.ts` | both | Typed CSV and email loaders |
| `src/lib/today.ts` | both | `today()` reads `APP_TODAY`; never call `new Date()` for "today" in a rule |
| `src/lib/db.ts` | Loop A | Prisma client, created on first use |
| `src/lib/db-guard.ts` | Loop A | With `BRIM_LOCAL_DB_ONLY=1`, Prisma and `db()` refuse non-local databases |

## Pull request checks

GitHub Actions runs typecheck, lint, and Vitest against a fresh local Postgres database after applying migrations and seeding the open dataset.

Vercel sends deployment events to the workflow on `main`. For each Brim preview it posts `Brim preview / Neon` on the deployed commit. The workflow records the `/api/health` result for each deployment ID and uses Vercel’s commit statuses to select the latest deployment for the required check. A skipped preview can pass when the entire change since the merge base is limited to `Not_Brim/` or root Markdown files. Protected previews accept a short-lived GitHub OIDC token with audience `brim-preview-health` from the preview workflow on `main`.

After the workflows land on `main` and run on a PR, select `Brim tests, types, and lint` and `Brim preview / Neon` as required status checks in GitHub's branch rules.
