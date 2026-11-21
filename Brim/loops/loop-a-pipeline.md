# Loop A: pipeline

Branch: `loop/pipeline` · Phases 1 and 3 of `Brim/BUILD_PLAN.md` · Needs Neon and a Claude API key.

Before starting:
- Phase 0 (Next.js, Prisma, Vitest, `config.ts`, `APP_TODAY`) and `src/lib/types.ts` (`Extracted`, `NormalizedInvoice`) are already on `main`.
- Branch from `main`: `git switch -c loop/pipeline`.
- Run in auto mode or with an allowlist so the loop does not stall on a permission prompt.
- This loop is the only one allowed to run migrations or the seed.

Paste the block below into Claude Code:

```
/loop You are building Loop A (pipeline) for Brim AP automation, on branch loop/pipeline.
Spec: Brim/BUILD_PLAN.md (phases 1 and 3). If it conflicts with PLAN.md, BUILD_PLAN wins; if it conflicts with the dataset, the dataset wins.
Each run: read Brim/progress/pipeline.md (create it from phases 1 and 3 if missing), pick the first unchecked item, implement it, run tests, commit with a clear message, tick the item, log anything surprising.
Hard rules:
- Never open any file listed in brim_ap_dataset/sealed_invoices.txt, or the emails that carry them.
- No vendor names, file names or invoice numbers in rule code.
- Only touch src/lib/types.ts by appending; note any change in the progress file.
- Never push to main, never force-push, never drop the database except via the seed script.
- If a decision isn't covered by BUILD_PLAN.md, write it to Brim/progress/questions.md, pick the safest option, and move on.
Stop the loop when every item is ticked and the phase 1 and 3 "done when" checks pass.
```
