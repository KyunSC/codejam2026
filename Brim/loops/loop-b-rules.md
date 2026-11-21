# Loop B: rules engine

Branch: `loop/rules` · Roles and permissions, Resolution, Checks, Duplicate detection, Smart coding and Approval routing from `Brim/BUILD_PLAN.md` · Needs only the CSVs. No database, no UI.

Before starting:
- Phase 0 (Next.js, Prisma, Vitest, `config.ts`, `APP_TODAY`) and `src/lib/types.ts` (`Extracted`, `NormalizedInvoice`) are already on `main`.
- Branch from `main`: `git switch -c loop/rules`, then `npm install`.
- No `.env` is needed. Tests pin `APP_TODAY` to 2026-11-02 in `vitest.config.mts`.
- Run in auto mode or with an allowlist so the loop does not stall on a permission prompt.
- This loop never connects to the database.
- In Claude Code, open `/config` and check that auto-compact is on.
- Keep the laptop plugged in with the lid open, on a connection that won't drop overnight.
- Start Claude Code inside `tmux` under `caffeinate`, so the machine can't sleep while the loop runs and the loop survives an accidental terminal close:

  ```bash
  tmux new -s loop-b
  caffeinate -is claude
  ```

  On Windows use PowerToys Awake or set sleep to "Never"; on Linux use `systemd-inhibit claude`.

Paste the block below into Claude Code:

```
/loop You are building Loop B (rules engine) for Brim AP automation, on branch loop/rules.
Spec: Brim/BUILD_PLAN.md: Roles and permissions, Resolution, Checks, Duplicate detection, Smart coding, Approval routing. If it conflicts with PLAN.md, BUILD_PLAN wins; if it conflicts with the dataset, the dataset wins.
Everything is pure TypeScript over the CSVs (load them with src/lib/dataset.ts), with no database and no UI. Thresholds come from src/lib/config.ts and "today" from src/lib/today.ts. Vitest pins APP_TODAY=2026-11-02; any script run outside Vitest (e.g. the history replay) must set APP_TODAY=2026-11-02 itself, so results match BUILD_PLAN. Each check is one function (invoice, refs) => Flag[] with a table test (at least one firing and one non-firing case).
Each run: read Brim/progress/rules.md (create it if missing; first item: write a script that verifies the counts in BUILD_PLAN's Tables section and log any mismatch), pick the first unchecked item, implement it, run tests, commit, tick it.
Hard rules:
- Never open any file listed in brim_ap_dataset/sealed_invoices.txt.
- No vendor names, file names or invoice numbers in rule code; thresholds go in config.ts.
- Consume src/lib/types.ts; never edit it. If you need a field, write it to Brim/progress/questions.md.
- Never push to main or force-push.
- Undecided points (e.g. the bank-change block vs. info rule) go to questions.md; take BUILD_PLAN's version and move on.
Stop the loop when the history replay matches "What is planted" (or each difference is explained in rules.md), the five worked routing examples pass, and both coding accuracy numbers are printed.
```
