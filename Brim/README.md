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

## Shared code

| File | Owner | Rule |
| -- | -- | -- |
| `src/lib/types.ts` | both | The pipeline/rules contract. Loop A may append; Loop B never edits |
| `src/lib/config.ts` | both | Every threshold. Rules never hard-code a number |
| `src/lib/dataset.ts` | both | Typed CSV and email loaders |
| `src/lib/today.ts` | both | `today()` reads `APP_TODAY`; never call `new Date()` for "today" in a rule |
| `src/lib/db.ts` | Loop A | Prisma client, created on first use |
| `src/lib/db-guard.ts` | Loop A | With `BRIM_LOCAL_DB_ONLY=1`, Prisma and `db()` refuse non-local databases |
