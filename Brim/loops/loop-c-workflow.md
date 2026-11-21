# Loop C: workflow, payments, vendors, audit

Branch: `loop/workflow` · Connects the pipeline (Loop A) to the rules engine (Loop B), then builds BUILD_PLAN phases 6–9 and 12: approvals, payments, vendors, audit pack, Fraud watch, reconciliation. Code freeze is **Sun 2026-11-22, 12:00**.

Before starting:
- Branch from `main`: `git switch -c loop/workflow`.
- `.env` must point `DATABASE_URL` at the **local** Postgres. Never use the shared Neon one for this loop.
- Run in auto mode or with an allowlist, so the loop does not stall on a permission prompt.
- In Claude Code, open `/config` and check that auto-compact is on.
- Start Claude Code inside `tmux` under `caffeinate`:

  ```bash
  tmux new -s loop-c
  caffeinate -is claude
  ```

Paste the block below into Claude Code:

```
/loop You are building Loop C (workflow, payments, vendors, audit) for Brim AP automation, on branch loop/workflow, in Brim/.
Read first: Brim/AGENTS.md, Brim/README.md, then Brim/BUILD_PLAN.md (Approval routing, Payments, Vendor management and bank changes, Audit trail, Data model, Server API, Screens, Bonus, Testing). BUILD_PLAN wins over PLAN.md; the dataset wins over both. This Next.js version differs from your training data: read node_modules/next/dist/docs/ before writing routes or pages.
What exists: the pipeline in src/lib/pipeline (intake, extraction, normalisation, run.ts), the rules engine in src/lib/rules (resolve, checks/runChecks, coding, routing/policy+route, release eligibility), the permission matrix in src/lib/auth/matrix.ts, the audit writer in src/lib/audit.ts + src/lib/audit/chain.ts, org-scoped services in src/lib/*/service.ts, and pages for invoices, settings and audit. Today nothing outside scripts calls the rules engine. Reuse these; do not rewrite them. Fix a bug in rules code only with a failing test first.
Each run: read Brim/progress/workflow.md (create it from the item list below if missing), pick the first unchecked item, implement it with tests, run `npm test`, `npm run typecheck` and `npm run lint` from Brim/, commit on loop/workflow, tick the item, and note anything surprising under it. If an item is too big for one run, split it into sub-items in the file and do the first.
Items:
1. Local setup green: npm install, npx prisma generate, apply migrations and seed the local DB with BRIM_LOCAL_DB_ONLY=1 (README "Harborline pipeline"), then ingest-inbox.ts --run. Get test and typecheck to pass; record any test that still fails and why.
2. The single guarded invoice status transition function (BUILD_PLAN status machine, heldFrom, version optimistic lock), writing its audit row in the same transaction. Replace any direct status writes.
3. processInvoice service: normalized invoice → resolve → runChecks → Flag rows with evidence → coding suggestions + reasons on InvoiceLine → status (needs_review or coded) through the transition. Call it from run.ts after extraction and from POST /api/orgs/[slug]/invoices/[id]/process. Add the missing intake audit rows (invoice.receive, email.label). Re-run on the 41 local drafts and compare against BUILD_PLAN "Unsealed batch: expected"; log differences.
4. Invoice screen: flags as sentences with evidence and the resolving action (POST .../flags/[flagId]/resolve, by flag class, reason required), fields with evidence marks, lines with suggested coding and reason, accept/override coding via PATCH with If-Match version.
5. Approvals: submit (OPEN_FLAGS, CODING_INCOMPLETE, STEP_UNRESOLVABLE) creating ApprovalStep rows from routing, route-preview, approve/reject (NOT_YOUR_STEP, SELF_APPROVAL, VERSION_CONFLICT), delegation (PUT me/delegation, recorded as onBehalfOf), approval chain on the invoice screen, a "Waiting for me" page. The five worked examples pass in a test against the DB.
6. Payments: prepare, release (limits, APPROVER_CANNOT_RELEASE, holds, bank change unverified, vendor not payable), simulate bank run (references, statement lines, card txns, cheques, failures), invoice state follows payment, payments dashboard by bucket and currency showing who may release. Day-one state per BUILD_PLAN (AP-00394/AP-00407, AP-00426).
7. Vendors: list and detail (AP invoices + card charges, bank masked by role), onboarding as pending_review, approve/hold/release-hold with FOUR_EYES, bank change requests and verify/reject with CALLBACK_REQUIRED. V004 held until a second person verifies BC-009.
8. Audit: audit pack per payment (history and new), filters on the global log, CSV export (auditor read-only, enforced server-side), verify chain action reporting the first bad row.
9. Navigation and landing pages per role (BUILD_PLAN Screens): employee submissions, AP review queue flagged first, Inbox / Needs attention, finance manager and controller queues, auditor read-only banner. Every route checks the matrix server-side.
10. Policy editor for the controller: rules as rows, conditions/steps as dropdowns, locked rules locked, "Try on an invoice" preview (LOCKED_RULE, BAD_CONDITION).
11. Fraud watch page (finance manager, controller): every open fraud flag across invoices, vendors and payments with amount at stake; SENDER_DOMAIN_MISMATCH and SENDER_LOOKALIKE_DOMAIN shown; open fraud flag blocks release.
12. Bank reconciliation: match order and expected counts from BUILD_PLAN Bonus, unmatched items explained, "Mark explained" audited.
Hard rules:
- Never open, read, extract or print any file listed in brim_ap_dataset/sealed_invoices.txt, or the emails that carry them.
- Migrations and the seed run only against local Postgres with BRIM_LOCAL_DB_ONLY=1. Never run migrations, the seed or destructive SQL against Neon.
- The LLM only reads documents; rules code makes every decision. Every threshold in src/lib/config.ts. "Today" via today() from src/lib/today.ts, never new Date().
- Every mutation writes its audit row in the same transaction; audit rows are never updated or deleted. Status changes only through the transition function.
- src/lib/types.ts is append-only.
- Never push to main, never force-push, never rewrite history. Commit only on loop/workflow. Never commit .env.
- Undecided points go to Brim/progress/questions.md under "## Loop C": take BUILD_PLAN's version and move on.
- Working end to end beats polish. If an item is stuck after two runs, write why in workflow.md, mark it blocked, and move on.
Stop the loop when all 12 items are ticked (or blocked with a reason), or at 2026-11-22 11:00 local time, whichever comes first. Before stopping, make sure tests, typecheck and lint pass on the last commit and write a short summary at the top of workflow.md: what works, what does not, and what to demo.
```
