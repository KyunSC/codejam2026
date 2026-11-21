# Open questions

## Loop A

Decisions not covered by BUILD_PLAN.md, with the option picked. Newest last.

- **Local database port (1.1).** The loop file says Docker on 5433, but `.env` points at Postgres.app on `localhost:5432` (database `brim`). It is local, so the guard accepts it; I used it as is.
- **Where uploaded file bytes live (1.1).** BUILD_PLAN says Vercel Blob. Picked: `Document.data` (bytea) plus `Document.url`, so the loop runs with no Blob store; dataset files use `url = dataset:incoming_invoices/<name>`. Blob can fill `url` later without a schema change.
- **Policy types location (1.2).** Loop B builds routing and may define its own `Condition`/`Effect`. Picked: appended BUILD_PLAN's shapes to `src/lib/types.ts` (the shared contract) with two additions, `{ any: [...] }` for P05's OR and `poPresent` for P13. If Loop B has its own copy, merge onto the types.ts one.
- **V004's live account (1.5).** BUILD_PLAN says the live account changes only when a request is verified, but `vendors.csv` already holds the account from unverified BC-009, and the old full account is unknown (only `7504`). Picked: the CSV account is live, BC-009 is `pending`, and the hold comes from the pending request. Rejecting BC-009 later cannot restore the old account, only its last 4 digits; that path should keep payments held and say why.
- **History payment status `outstanding` (1.6).** BUILD_PLAN's payment states are scheduled/released/sent/settled/failed; the CSV has `outstanding` for 20 mailed cheques. Picked: store them as `sent` (mailed, not cleared). Reconciliation will show all 20 have in fact cleared on the statement.
- **Seeded inbox documents (1.8).** Stored by SHA-256 with `url = dataset:incoming_invoices/<name>` and no bytes in `Document.data`; uploads still go in `data`. Seed creates the emails unlabelled and no draft invoices, leaving that to intake. Picked as the safest: seeding never runs extraction.
- **Amounts with a stray comma (3.1).** BUILD_PLAN says any comma not followed by exactly two final digits is a thousands separator, which would read `12,5` as 125. Picked the safer reading: a thousands separator must sit between groups of three digits, otherwise AMOUNT_UNPARSEABLE and the clerk looks. Same rule for dots when the comma is the decimal mark.
- **Ambiguous dates (3.2).** A date like `03/04/2026` could be settled by the document's language (French → day first). Not done: BUILD_PLAN says it raises DATE_AMBIGUOUS, so no date is picked and the two candidates go to the clerk. Two-digit years are rejected rather than guessed.
- **Node version (3.5).** Local Node is 20.20; pdfjs-dist 6 targets Node 22+. Polyfilled `Promise.withResolvers` in `src/lib/pipeline/pdf.ts` rather than downgrading. Vercel should run Node 22 or 24 anyway; worth setting the project's Node version there.
- **next.config.ts touched (3.5).** Added `serverExternalPackages: ["pdfjs-dist"]`. Loop B: merge, don't overwrite.
- **needs_review rule (3.6).** BUILD_PLAN: "any `uncertain` or `unreadable` required field". Picked the safer superset: required fields (vendor name, invoice number, invoice date, total) also go to review when `not_in_text` (the model wrote something not on the page) or `missing`; any uncertain/unreadable field anywhere goes too. Subtotal is not required (one-line invoices may not print one).
- **Unchecked scan fields (3.6).** `FieldEvidence` has no "unchecked" value and types.ts is append-only, so a scan's text fields that no second read covered get no evidence entry. The review screen should show a missing entry as "not checked".
- **Credit note sign (3.7).** BUILD_PLAN shows the incoming credit note as −$672.00 but does not say how to store one printed in positives. Normalisation negates every money field of a `credit_note` whose total is positive, so credits always net against invoices; quantities keep their sign.
- **Extraction cache is a folder, not a table (3.8).** The schema has no cache table and Loop B shares the schema, so real answers go to `Brim/extraction-cache/<sha256>.json`. It can be committed so a deployment without a key still has every paid-for answer. Override with `EXTRACTION_CACHE_DIR`.
- **Bill-to GST number (3.9).** Every incoming invoice prints Harborline's own `GST/HST 100000001RT0001` in the bill-to block. The extraction prompt (3.10) must say the vendor's tax number is the one in the vendor block; normalisation will also treat `100000001RT0001` as not the vendor's if it ever comes through (pending, 3.10). Resolution should never match a vendor on it.
- **"Forced to answer through this schema" (3.10).** BUILD_PLAN asks for a forced tool call, but the extraction model (claude-sonnet-5-5) returns 400 on forced `tool_choice` (`any`/`tool`). Chose structured outputs (`output_config.format` with the `Extracted` JSON schema), which constrains the reply to that schema, plus a code-side shape check. Also turned on server-side fallbacks so a refusal retries on a fallback model. Not yet run against the real API (no key).
- **Email labeller has no fallback (3.11).** Haiku 5.5 rejects server-side `fallbacks`, so a refused or failed label is a named failure and the email waits in "Needs attention" rather than being retried on another model. The labeller returns only the four attachment-less labels; linking a payment inquiry to its invoice (AP-00049) is left to intake by sender and invoice number.
- **Intake writes no audit events yet (3.12).** BUILD_PLAN puts the audit writer in phase 2, which this loop does not build. Intake creates drafts and labels without audit rows; once the writer exists, `intakeEmail`/`intakeFile` should call it inside the same transaction (`invoice.receive`, `email.label`).
- **Where a second arrival of the same file is recorded (3.12).** BUILD_PLAN: "the second arrival points at the first". Chose not to change the schema: intake creates no second draft and returns `already_received` with the first draft's id; the second email keeps its attachment names in `InboxEmail.attachments`. A schema column (e.g. a link table email↔document) would make it visible in the UI; left for whoever owns the inbox screen.
- **Statement / inquiry sender lookup (3.12).** Vendors are found by exact `apContactEmail` match (case-insensitive). When several vendors share an address (V001/V051), the one whose legal name appears in the sender's display name wins if exactly one does; otherwise the link is left empty. A lookalike domain never matches.
- **Where a non-invoice ends (3.13).** BUILD_PLAN: a file that is "not an invoice" ends "as a non-invoice with its label". There is no non-invoice status, and `void` is a clerk/controller action with a reason. Chose: the draft goes to `needs_review` with `docType` = statement/other and the email labelled the same, so a person voids or reclassifies it. Nothing auto-voids.
- **API errors leave the draft in `received` (3.13).** A failed or refused model call is not "no usable extraction" of the file, so it does not raise `UNREADABLE`; the draft stays `received` and the next run retries. Only an unusable answer (cut off, not JSON, wrong shape) or a file that does not open raises `UNREADABLE`.
- **Which flags run.ts raises (3.13).** Only `UNREADABLE`. `FIELD_UNCERTAIN`, `ARITHMETIC_*`, `DATE_*` are checks (Loop B, `(invoice, refs) => Flag[]`); run.ts stores the evidence and arithmetic they need and sets `needs_review` from evidence.
- **Ingest without extraction by default (3.15).** The ingest script only drafts and labels; `--run` extracts too. Without a key, `--run` would store the seven hand-made answers as real extracted invoices in the local DB, so the committed state was ingested without it. Safest option; revisit once a key exists (3.16).
- **3.16 needs key.** Real extraction of the 41 unsealed files and the real Haiku labels cannot run without `ANTHROPIC_API_KEY`. The drafts are in the local DB in `received`; with a key, `npm run script -- scripts/ingest-inbox.ts --run` extracts them (cached per hash), then `scripts/check-pipeline.ts` and a comparison against "Unsealed batch: expected" close phase 3.
- **The local DB now holds hand-made extractions (3.16).** At the user's request, all 41 inbox drafts were extracted from hand-made answers, so later phases have real invoices to work on. Each is marked `normalized.extraction.source = "recorded"`. `runPipeline` only takes drafts in `received`, so once a key exists, run `npm run db:seed`, then `ingest-inbox.ts --run`, to replace them with real Claude reads.

## Loop B

Open points for the team. Loop B takes BUILD_PLAN's version and moves on.

- **ResolvedInvoice has no invoice id.** Checks that need the invoice's own approvals or payments (e.g.
  SELF_APPROVAL in the history replay) read it from `refs.self.invoiceId` instead. If Loop A wants it on
  the type, append `invoiceId: string | null` to `ResolvedInvoice`; Loop B will switch to it.
- **Class/effect for codes not in the Checks table.** Loop B uses DATE_AMBIGUOUS data/hold (the date decides
  due date and FX), FX_RATE_FALLBACK data/info, SHIP_TO_UNKNOWN data/hold (the province decides the tax).
- **FIELD_UNCERTAIN and `not_in_text`.** Only `uncertain`, `unreadable`, `missing` or a null value hold, as
  BUILD_PLAN says. A value that is `not_in_text` does not hold; should it?
- **What counts as "little history" for VENDOR_LOOKALIKE?** Loop B uses: this record has at most 3 known
  invoices and no more than its lookalike. That flags invoices from V051 (3) and V053 (2) in history, plus V052.
- **Bank change: block or info?** PLAN.md says a recent bank change blocks release until verified; BUILD_PLAN
  makes BANK_CHANGE_UNVERIFIED fraud/hold and BANK_CHANGE_RECENT fraud/info (a verified recent change only
  informs). Loop B follows BUILD_PLAN.
- **AP-00388** (V004) was paid on 2026-10-29, two days after V004's unverified bank change (BC-009,
  2026-10-27). Its payment was scheduled on 10-26, so the check does not flag it. Was it paid to the old or
  the new account? Reconciliation may want to show this.
- **SPLIT_SUSPECTED and requester.** BUILD_PLAN says "same vendor"; PLAN.md says "same vendor + requester".
  Loop B requires the same requester when both are known (history then gives exactly the two planted groups;
  vendor alone adds AP-00120, AP-00191 and AP-00303/00304). Unknown requester matches anyone, so the incoming
  three-on-one-day case still fires.
- **SELF_APPROVAL class/effect** as a history finding: Loop B uses fraud/info.
- **P05 as a structured rule.** BUILD_PLAN's conditions are ANDed, so "pending_review or new" is written as
  `flag in [VENDOR_PENDING, VENDOR_NEW]` (the checks state both facts). Fine for the policy editor?
- **No eligible releaser** (worked example 5, and anything over $250,000): Loop B blocks with the reason, as
  BUILD_PLAN decides (Risks 2). Still worth confirming with Brim.
- **Release ordering**: `releaseEligibility` lists finance manager first, then the controller, then the CFO.

## Loop C

Open points for the team. Loop C takes BUILD_PLAN's version and moves on.

- **Unregistered supplier charging no tax (item 3).** BUILD_PLAN expects only `TAX_NOT_REGISTERED` on `riverbendcaterin_1739`, but `TAX_WRONG_FOR_PROVINCE` also fired. Changed the check: no tax charged and no tax number on the invoice or on file → no tax-province flag (an unregistered small supplier may not charge GST). Charging the wrong tax still fires.
- **SPLIT_SUSPECTED on one invoice of the group (item 3).** Only the invoice that completes the group carries the flag. Its route adds the combined-amount steps; the earlier two route on their own amount. If the team wants all three held together, the submit step could look up open split groups.
- **Workflow ids are dataset ids.** ApprovalStep, Flag resolvers and `Invoice.requesterId` use `User.externalId` (U001 …) like the imported history; people added in the app fall back to their row id.
- **Audit chain lock.** Every audit write takes a per-organization advisory lock to link the hash chain, which serialises writers. Fine at this volume; BUILD_PLAN's "a chain per day with anchors" is the scale answer.
- **No eligible releaser (item 5).** BUILD_PLAN's worked example 5 says "Held with that reason". Loop C refuses at submit (422 STEP_UNRESOLVABLE, message from releaseEligibility) instead of letting three people approve an invoice nobody can pay. The route preview shows the same reason before submitting.
- **Resubmission after a rejection (item 5).** `ApprovalStep` has a unique (invoiceId, stepNo), so a new round replaces the old step rows. The earlier decisions stay in the audit log (`invoice.approve` / `invoice.reject`). A `round` column would keep them as rows; not added (schema is Loop A's).
- **Submit requires accepted coding (item 5).** CODING_INCOMPLETE fires while any line has no `glFinal`: a suggestion counts only once the clerk accepts it ("Accept all suggestions" on the screen).
