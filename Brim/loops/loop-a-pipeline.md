# Loop A: pipeline

Branch: `loop/pipeline` · Phases 1 and 3 of `Brim/BUILD_PLAN.md` · Runs without Neon or a Claude API key: it uses a local Postgres and a stand-in for the extraction call.

Before starting:
- Phase 0 (Next.js, Prisma, Vitest, `config.ts`, `APP_TODAY`) and `src/lib/types.ts` (`Extracted`, `NormalizedInvoice`) are already on `main`.
- Branch from `main`: `git switch -c loop/pipeline`, then `npm install`.
- Start a local Postgres (Docker shown; Postgres.app or Homebrew also work):

  ```bash
  docker run -d --name brim-pg -e POSTGRES_PASSWORD=brim -e POSTGRES_DB=brim -p 5432:5432 postgres:16
  ```

  Then create `Brim/.env` with both database names pointing at it (Prisma migrate reads the second one):

  ```bash
  DATABASE_URL="postgresql://postgres:brim@localhost:5432/brim"
  DATABASE_URL_UNPOOLED="postgresql://postgres:brim@localhost:5432/brim"
  APP_TODAY="2026-11-02"
  ```

  Leave `ANTHROPIC_API_KEY` out unless you have one; the loop works around it.
- Run in auto mode or with an allowlist so the loop does not stall on a permission prompt.
- This loop is the only one allowed to run migrations or the seed, and only against the local database.
- In Claude Code, open `/config` and check that auto-compact is on.
- Keep the laptop plugged in with the lid open, on a connection that won't drop overnight.
- Start Claude Code inside `tmux` under `caffeinate`, so the machine can't sleep while the loop runs and the loop survives an accidental terminal close:

  ```bash
  tmux new -s loop-a
  caffeinate -is claude
  ```

  On Windows use PowerToys Awake or set sleep to "Never"; on Linux use `systemd-inhibit claude`.

Paste the block below into Claude Code:

```
/loop You are building Loop A (pipeline) for Brim AP automation, on branch loop/pipeline.
Spec: Brim/BUILD_PLAN.md (phases 1 and 3). If it conflicts with PLAN.md, BUILD_PLAN wins; if it conflicts with the dataset, the dataset wins.
Use the shared code: src/lib/dataset.ts to read the CSVs, src/lib/config.ts for thresholds and model ids, src/lib/today.ts for "today", src/lib/db.ts for Prisma.
Each run: read Brim/progress/pipeline.md (create it from phases 1 and 3 if missing), pick the first unchecked item, implement it, run tests, commit with a clear message, tick the item, log anything surprising.
Environment:
- The database is the local Postgres in Brim/.env. Never connect to Neon or any remote database. If the database is unreachable, log it in questions.md and work on items that do not need it.
- There may be no ANTHROPIC_API_KEY. Put the Claude calls (extraction, email labelling) behind an interface. Without a key, use a stand-in that returns recorded answers: write Extracted JSON by hand for a few unsealed files, store them under Brim/fixtures/extracted/ marked as hand-made, and test normalisation, evidence and intake against them. Hand-made answers must never go into the real per-hash extraction cache. Mark any item that needs a real call "needs key" in pipeline.md and questions.md, and move on.
Hard rules:
- Never open any file listed in brim_ap_dataset/sealed_invoices.txt, or the emails that carry them.
- No vendor names, file names or invoice numbers in rule code.
- Only touch src/lib/types.ts by appending; note any change in the progress file.
- Never push to main, never force-push, never drop the database except via the seed script.
- If a decision isn't covered by BUILD_PLAN.md, write it to Brim/progress/questions.md, pick the safest option, and move on.
Stop the loop when every item is ticked or marked "needs key", and the phase 1 and 3 "done when" checks that need no key pass.
```
