# Loop A progress: pipeline (BUILD_PLAN phases 1 and 3)

Branch `loop/pipeline`. One item per run: implement, test, commit, tick. Items that need a real
Claude call are marked **needs key** and skipped when `ANTHROPIC_API_KEY` is unset or blank.

## Phase 1: schema, seed, history import

Done when: row counts equal the Tables section; history approvals and payments appear as audit
events; the seed skips sealed files.

- [x] 1.1 Prisma schema for every model in BUILD_PLAN "Data model" plus the reference tables; first migration applied to the local database
- [x] 1.2 Policy rows: P01–P13 mapped by hand to structured `PolicyRule` (`when`, `effect`, `sourceText`, locked P07/P08/P11), pure module + test
- [x] 1.3 Audit hash chain: canonical JSON, `sha256(prevHash + json)`, `verifyChain` reporting the first bad row; pure + test
- [x] 1.4 Seed script (`prisma/seed.ts`, run by `prisma db seed`): wipes and loads reference tables (users, departments, GL accounts, tax codes, vendors, contracts, POs, FX, bank statement, card transactions, policy rules)
- [x] 1.5 Seed: versioned vendor bank accounts and the 9 bank change requests (BC-009 unverified)
- [x] 1.6 Seed: history invoices, lines, taxes, approval steps, payments (ids kept; `source: history`)
- [x] 1.7 Seed: 474 history approvals and 415 history payments as hash-chained `history` audit events
- [x] 1.8 Seed: inbox emails and documents for the unsealed files only; sealed files and the emails that carry them are skipped without being opened
- [x] 1.9 Seed check: a test against the local database asserting the Tables counts, the audit chain verifying, and no sealed file present

## Phase 3: intake, extraction, normalisation

Done when: 41 unsealed files become drafts; every text-layer value agrees or is marked; the scan
reads; the broken inputs listed in Testing end in named states.

- [ ] 3.1 Normalise amounts: `$`, spaces, decimal comma rule, sign, `Decimal`; table test incl. `1 014,18 $`
- [ ] 3.2 Normalise dates: ISO, `DD/MM/YYYY`, `MM/DD/YYYY`, English and French month names; `DATE_AMBIGUOUS`; table test
- [ ] 3.3 Normalise tax labels (code + printed rate), terms (`Net N`, `Due on receipt`, `2/10 Net 30`), currency from the total label, invoice number keys; table tests
- [ ] 3.4 FX lookup for the invoice date with `FX_RATE_FALLBACK` past the last row; pure + test
- [ ] 3.5 Document inspection: SHA-256, mime sniffing, page count, PDF text layer, encrypted/corrupt/zero-byte detection (adds a PDF library)
- [ ] 3.6 Field evidence: text-layer matching after normalising spaces, arithmetic closure (line, subtotal, total), `needs_review` decision; table test
- [ ] 3.7 `normalize(extracted, ctx) → NormalizedInvoice` assembling 3.1–3.6, with parse issues; test
- [ ] 3.8 Extractor interface; key detection (unset or blank after trim = missing); per-hash cache for real answers only; recorded stand-in reading `fixtures/extracted/` (hand-made, never written to the cache)
- [ ] 3.9 Hand-made `Extracted` fixtures for a few unsealed files (English, French, credit note, arithmetic error, USD), marked hand-made; normalisation and evidence tests against them
- [ ] 3.10 Claude extractor (Sonnet, forced tool schema, PDF/image as is, second read for scans whose arithmetic does not close); unit test with a mocked client
- [ ] 3.11 Email labeller interface: Haiku labeller for emails without attachments, recorded stand-in for EM-056..059; unit test with a mocked client
- [ ] 3.12 Intake: store file by SHA-256 as `Document` (same hash → points at the first), one draft per attachment, label attachment-less emails; accepts loose files or `emails.json` + files
- [ ] 3.13 `run.ts`: intake → extract → normalise, storing each stage's output; every file ends in a named state (`extracted`, `needs_review` + `UNREADABLE`, or a non-invoice label)
- [ ] 3.14 Broken inputs (made up): zero-byte, truncated PDF, password-protected PDF, blank image, non-invoice photo, two-page PDF, same file twice; each ends in a named state (test)
- [ ] 3.15 Ingest script for the unsealed inbox into the local database: 41 files become drafts, EM-029 gives two, EM-056..059 get their labels
- [ ] 3.16 Real extraction of the 41 unsealed files: every text-layer value agrees or is marked; the scan reads
- [ ] 3.17 Done-when report: run the phase 1 and phase 3 checks that need no key and record the results here

## Notes and surprises

- 1.1: Vendor bank details live only in `VendorBankAccount` (versioned; `validTo = null` is live), not on `Vendor`. `BankChangeRequest` keeps `newLast4` because the history CSV has only the last 4 digits. `Document.data` holds uploaded bytes so local runs need no Blob store. Added `Invoice.docType`, `Invoice.normalized` and `Invoice.uploadedById` beyond the plan's list, for stage outputs and the requester rule. `npx tsc` alone fails on `LayoutProps`; use `npm run typecheck` (runs `next typegen` first).
- 1.2: **types.ts appended** with `StepRole`, `Condition`, `Effect`, `PolicyRule` (BUILD_PLAN's shapes). Two additions to `Condition`: `{ any: Condition[] }` because P05 is an OR, and `{ field: 'poPresent' }` because P13 needs "no PO present". P09/P10 compare `totalCad` (one payment per invoice, so payment CAD = invoice CAD). Mapping lives in `src/lib/policy/seed-rules.ts`; `sourceText` is `condition → required`.
- 1.3: `src/lib/audit/chain.ts`. `seq` is not hashed (the database assigns it and can skip numbers on rollback); order comes from `seq`, integrity from the `prevHash` links. Canonical JSON sorts keys at every depth, so jsonb's key reordering on read does not break verification. Decimals hash as their `toJSON` string, the same text Prisma stores.
- 1.4: `npm run db:seed` (= `prisma db seed` → `node scripts/run.mjs prisma/seed.ts`). Wipe is one `TRUNCATE … RESTART IDENTITY CASCADE` over every table; load runs in one transaction. Reference counts match the Tables section on the first run (users 40 … policy rules 13). Dataset timestamps have no zone; stored as written, read as UTC.
- 1.5: **Surprise:** `vendors.csv` already shows V004's *new* account (…9679) although BC-009 was never verified; the history gives only the last 4 digits of replaced accounts. So `VendorBankAccount` now allows null institution/transit/account with a required `last4` (migration `bank_account_last4`): 49 live accounts + 9 last-4-only history versions = 58 rows. The CSV account is the live one (dataset wins); BC-009 is imported `pending`, which is what holds V004. Verified history requests have `verifiedById = null` (the CSV does not say who called back). The two CSVs agree: every change's new last 4 equals the account on file.
- 1.6: History loads 426 invoices, 809 lines, 443 tax rows, 474 approval steps, 415 payments. Payment status `outstanding` (20 cheques) is stored as `sent`, the app's word for a mailed cheque not yet cleared. Invoice status is kept as the CSV writes it. History has no printed tax label, so `InvoiceTax.labelPrinted` is the code. Every history invoice uses one tax code per column, so tax rows are coded from the lines. `invoiceNumberKeys` (item 3.3's number keys) was written here, early, in `src/lib/pipeline/normalize/invoice-number.ts`; 3.3 reuses it.
- 1.7: 889 history audit events (462 approve, 12 reject, 397 `payment.release`, 18 `payment.schedule`), sorted by time and chained. payments.csv has no preparation time, so an unreleased payment's event is dated its invoice's last approval and its reason says so; released payments are dated the paid date. The seed reads the chain back in `seq` order and fails if it does not verify.
- 1.8: 44 inbox emails and 41 documents seeded; 15 sealed emails skipped. Sealed/open is decided by attachment name only (`src/lib/pipeline/sealed.ts`); an email mixing sealed and unsealed attachments would stop the seed (none does). Seeded documents keep their bytes in the dataset folder (`url = dataset:incoming_invoices/<name>`, `data` empty). Emails are stored unlabelled and no drafts are created: intake (3.12/3.15) does that, so the demo can show it.
- 1.9: `src/lib/seed/__tests__/seeded-db.test.ts` checks the seeded local database: Tables counts and breakdowns (roles, vendor status, invoice status and currency, payment method and status, approval decisions and roles), 889 history audit events with the whole chain verifying, 44 emails and 41 documents with nothing sealed. It is read-only (never reseeds, so it cannot wipe demo data) and skips when DATABASE_URL is unset. Phase 1 "done when" passes.
