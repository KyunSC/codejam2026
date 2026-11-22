# Plan: Brim AP Automation (CodeJam 16)

> **Historical.** This plan was written for the earlier Next.js/Prisma version of the app. The app is now an Express API and a React/Vite frontend over Postgres (`db/schema.sql`); see `README.md`. The business rules here still apply; file paths, tooling and contracts may not.

## Context
Brim's hackathon brief asks for a web app that moves a supplier invoice from inbox to (simulated) payment for a fictional company, Harborline Logistics (40 people, ~55 vendors, Canadian taxes, CAD/USD). It must have role-based approvals and a full audit trail. Scoring: required features 40%, technical depth Q&A 25%, UI 20%, bonus 15%. Required features are tested on a **hidden invoice batch**, so accuracy and robustness matter more than how many screens we have. Timing: coding started Fri 7pm, freeze **Sun 12:00pm** (about 40h). The pitch is 2–4 minutes, and the rest of judging is Q&A.

Decisions so far: **Next.js (App Router, TS) + Prisma + Postgres**, **Claude API** for extraction and classification, **team of 3–4**. The repo is empty apart from README.md. The dataset isn't in the repo yet, so the importer has to match whatever file formats it comes in (probably CSV/JSON plus PDFs and images).

Guiding principle: build all 9 required features to "works end to end" first, then polish UI, then add the 2 bonus features (fraud alerts, bank reconciliation), built deep. Everything should be deterministic and explainable. The LLM only reads documents. Rules code makes every decision.

## Architecture
```
Brim/                      (app lives here)
  prisma/schema.prisma     data model
  prisma/seed.ts           imports the Harborline dataset
  src/lib/auth/            session (pick-a-user login), permission matrix, guards
  src/lib/pipeline/        intake → extract → normalize → validate → dedupe → code → route
  src/lib/workflow/        approval policy engine, delegation, SoD checks
  src/lib/payments/        scheduling, release, simulated EFT state machine
  src/lib/audit.ts         append-only audit writer (used inside every mutation's transaction)
  src/app/(roles)/...      role-aware pages
  src/app/api/...          route handlers / server actions (all permission-checked)
```
- **Auth:** a demo login where you pick any seeded user (judges can switch roles instantly), stored as a signed cookie session. Every server action and route goes through `requirePermission(user, action, resource)`, which checks one central permission matrix keyed by role, plus resource scoping (own department, own submissions). The UI hides things using the same matrix, but the **server is the source of truth**.
- **Segregation-of-duties rules** live as code in `workflow/sod.ts`: requester ≠ approver (escalate to their manager), approver ≠ releaser, Finance Manager release limit $100k, a delegate acts as `actedBy=delegate, onBehalfOf=approver`.
- **Audit:** an `AuditEvent` table (actor, onBehalfOf, action, entity, entityId, before/after JSON, timestamp, reason). It's written in the same DB transaction as the change and never updated or deleted. Bonus: hash-chain each row to the previous one for tamper evidence (a good Q&A talking point).

## Data model (Prisma, key entities)
User(role, department, managerId, approvalLimit, province, status, onLeave, delegateId) · Department · GLAccount · TaxCode(rate, recoverable, province) · Vendor(status: active/pending/hold/blocked, taxNumbers, terms, paymentMethod, acceptsCard) · VendorBankAccount (versioned) + BankChangeRequest (requestedBy, verifiedBy, status) · Contract(rateCaps, spendLimit, endDate) · PurchaseOrder + POLine · Invoice(status machine, source, currency, fxRate, totals, deliveryProvince, fingerprint) · InvoiceLine(glSuggested, glFinal, deptSuggested, deptFinal, suggestionReason) · InvoiceTax(taxCode, amount) · Flag(type, severity, message, evidence JSON, resolvedBy) · ApprovalPolicy(conditions JSON, steps JSON, priority, active) · ApprovalStep(invoice, order, requiredRole/user, decidedBy, onBehalfOf, decision, comment) · Payment(method EFT/card/cheque, scheduledFor, status, releasedBy) · BankStatementLine · CardTransaction · FxRate · InboxEmail(classification, linked invoice) · Document(file path, mime, page images).

Invoice status machine: `received → extracted → needs_review → coded → pending_approval → approved → scheduled → released → paid` (+ `rejected`, `on_hold`, `duplicate`, `void`). Transitions are guarded by one function so illegal jumps are impossible.

## Feature plan (the 9 required)
1. **Intake.** Upload UI plus an "AP Inbox" importer that reads the provided email dataset. Claude Haiku classifies each email as invoice / credit note / statement / not-invoice / missing-attachment. Each attachment becomes a draft bill. Emails with no invoice get routed to a "Needs attention" queue with the reason shown.
2. **Extraction.** Claude Sonnet (`claude-sonnet-5-5`) gets the PDF or image as a native document input. It uses a tool/JSON schema covering vendor, invoice #, dates, PO ref, currency, lines, each tax line, totals and per-field confidence, and it handles French. Next comes **normalization in code**: date parsing (odd formats flagged), amount parsing (1 234,56), mapping tax labels (TPS/TVQ/HST/PST) to dataset TaxCodes, and vendor matching (tax number → exact name → fuzzy name). Low-confidence or unreadable scans go to `needs_review` with the fields highlighted. Raw LLM output is cached per file hash, so re-runs are free and deterministic. Load the `claude-api` skill when implementing.
3. **Smart coding.** A deterministic model built from the ~450 historical invoices: (a) vendor+description token TF-IDF / kNN over historical lines → GL+dept, (b) fallback to vendor default account, (c) requester's department. Show **why**, e.g. "18 of 20 past invoices from Vendor X with 'fuel surcharge' → 5120 Freight; vendor default 5120". Accept/override per line, and log overrides. Measure accuracy on a held-out month (we can say the number in Q&A).
4. **Validation & matching.** A rules engine where each rule outputs a `Flag` with evidence. Checks: vendor unknown/pending/blocked; bank details on invoice ≠ vendor master or recently changed; arithmetic (line sums, tax = base×rate within rounding, total); tax vs. delivery province (ON→HST 13%, QC→GST+QST, BC→GST+PST, AB→GST only, foreign/exempt); contract rate cap / expired contract / spend limit; PO match (2-way: PO exists, open, vendor matches, amount within tolerance, remaining balance); dates (future, before vendor onboarding, past due); USD → CAD via FX table on invoice date; credit notes (negative, link to original); **split-invoice detection** (same vendor + requester, several invoices just under a limit within N days).
5. **Duplicates.** Layered: exact (vendor + normalized invoice #), near (normalized # with stripped prefixes/zeros/punctuation + amount ± small tolerance + date window), reformatted (same vendor + same total + similar line set, via file hash and content fingerprint), and **already paid by card** (match amount/vendor/date against Brim card transactions, including FX). The UI shows the suspected original side-by-side with a similarity breakdown.
6. **Approval workflow.** A policy engine evaluates active `ApprovalPolicy` rows (conditions: amount bands in CAD, department, vendor new/flagged, GL category e.g. legal) and produces an ordered step list. Resolution: dept approver up to their limit → Finance Manager above it or when flagged/new vendor → Controller for top band. Requester = approver escalates to manager. Approver on leave goes to the named delegate (recorded as delegate). Former employee: reassign and flag it. An admin rules editor is a form-based condition/step builder with a "test this policy against invoice X" preview. One invoice detail screen shows document viewer + extracted fields + coding + flags + approval timeline + audit.
7. **Payments.** Approved invoices get queued and scheduled by due date and terms. Release is checked against role limits plus SoD. A simulated EFT state machine (scheduled → released → sent → settled / failed) is driven by a "simulate bank" job. A payments dashboard shows due this week, overdue, by status, and by currency. A changed bank account within X days blocks release until it's verified.
8. **Audit trail.** A filterable global log (Controller/Auditor). Per-payment "audit pack" view: payment → invoice → document → approvals (with delegate info) → GL coding → flags and resolutions. CSV export for the Auditor role, which is read-only and enforced server-side.
9. **Vendor management.** Vendor master list and detail. Onboarding form → `pending` until a Finance Manager approves it. Invoices from pending or held vendors can't be paid. A bank detail change becomes a `BankChangeRequest` that needs a second person (not the requester) to approve, and shows the history from the dataset.

## Bonus (only after all 9 work; chosen: 2, built deep)
1. **Fraud alerts:** suspicious bank-detail changes (unverified, recent, requested by a non-vendor contact, followed quickly by an invoice), lookalike sender domains (edit distance / homoglyphs vs. the vendor's known domain), and a sender whose display name matches a vendor but whose domain doesn't. Everything surfaces as Flags with evidence and blocks payment release until resolved. This reuses the validation engine, so build it first.
2. **Bank reconciliation:** match statement debits to payments (exact amount + reference → amount + date window → card transactions). Explain each unmatched item (bank fee, unknown debit, payment not yet cleared, amount mismatch) and give a reconciliation screen with a "mark explained" action that is audited.

## Decisions locked
- Scope: all 9 required features working end to end, with **extraction, validation, duplicates and approvals** built deep.
- Bonus: fraud alerts + bank reconciliation only. No AI recommendation and no analytics unless everything else is done.
- Hosting: **Vercel + Neon Postgres**, deployed Friday night so the whole team shares one DB and judges get a URL. Store uploaded files in Vercel Blob (or pre-extract the dataset files at seed time). Keep the LLM call per invoice under the serverless timeout, or run batch extraction as a seed-time script.
- Login: **pick-a-user switcher** over the seeded users, with a signed session cookie. The server enforces all permissions.

## Team split (3–4 people)
- **A: Data & pipeline.** Prisma schema, seed importer, intake, Claude extraction, normalization.
- **B: Intelligence.** Validation rules, duplicate detection, smart coding, held-out accuracy eval.
- **C: Workflow & money.** RBAC/permission matrix, SoD, approval policy engine, delegation, payments, audit writer.
- **D (or shared by C): UI.** App shell, role-aware navigation, invoice detail "one screen", dashboards, flag explanations, policy editor.

## Timeline (Fri 7pm → Sun 12pm)
- **Fri night (→ ~2am):** Scaffold Next.js + Prisma, create the Neon DB, deploy a hello-world to Vercel, schema, seed import of all datasets, demo login + permission matrix, audit writer. Extraction prototype on 5 sample invoices.
- **Sat morning:** Full pipeline on all ~55 incoming invoices. Validation and dupes v1. Approval engine v1. Invoice list and detail screens.
- **Sat afternoon:** Coding model and its explanations. Payments and the simulated EFT. Vendor onboarding and bank change control. Audit view and export.
- **Sat evening (feature freeze for required features ~10pm):** End-to-end run per role, fix accuracy issues found in the incoming batch.
- **Sat night:** UI polish, empty and error states, fraud alerts then bank reconciliation.
- **Sun 8am–11:30am:** Bug fixes on the deployed build. Pitch script (≤3 min, demo-first). **Q&A prep doc** covering how roles are enforced, the dupe/mismatch logic, bad-input handling, why the data model looks like this, and what breaks at 100× (sync LLM calls → queue/worker; fuzzy dupes O(n²) → blocking keys/indexes; audit table growth → partitioning; policy eval caching). Final commit before 12:00.

## Verification
- `npm run seed` loads every dataset, and row counts match the expected numbers (~40 users, ~55 vendors, ~450 historical invoices, ~600 card txns).
- Run the incoming batch through the pipeline, then check: every email classified, non-invoices routed out, the planted messes produce flags (duplicates, over-contract, wrong tax, bank change, split invoices, unknown vendor, USD, credit notes, arithmetic errors).
- Coding accuracy script: train on Jan–Aug history and test on Sep–Oct, then report GL top-1 accuracy.
- RBAC tests (Vitest): call each server action as each role, and confirm forbidden ones return 403 even if called directly. SoD cases: requester can't approve, approver can't release, FM release > $100k blocked, delegate recorded.
- Manual demo script per role: Employee submits → Clerk reviews/codes → Approver approves → FM releases → Auditor exports the audit pack.
- Robustness: feed a corrupted PDF, a blank image and a non-invoice. The app must flag them, not crash (the hidden batch will test this).
