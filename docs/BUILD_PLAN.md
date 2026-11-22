# Brim AP automation: build plan

> **Historical.** This plan was written for the earlier Next.js/Prisma version of the app. The app is now an Express API and a React/Vite frontend over Postgres (`db/schema.sql`); see `README.md`. The business rules here still apply; file paths, tooling and contracts may not.

Status: plan only, written Fri 2026-11-20 22:45 EST. No app code exists yet.
Freeze: Sun 2026-11-22 12:00, submitted through GitHub. About 37 hours from the time of writing.
Read first: the brief (`../Brim Hackathon Brief - AP Automation for Business Cards.pdf`), `PLAN.md`, `brim_ap_dataset/README.md`.
Relation to `PLAN.md`: every decision in it stands (stack, hosting, login, bonus choice, team split, timeline). This file adds what the dataset shows, the exact rules, the contracts between parts, and the order to build in.

Every count below was taken from the CSVs and from the 41 unsealed incoming files on 2026-11-20. The 15 files in `sealed_invoices.txt`, and the 15 emails that carry them, were not opened.

## Before starting

1. `sealed_invoices.txt` lists 15 incoming files held back as a stand-in for the judges' hidden batch. Do not open them or their emails until the sealed drill (see Testing). Seed and develop against the other 41 files.
2. When something here conflicts with the dataset, the dataset wins.

## Goal

A web app that takes a Harborline supplier invoice from the AP inbox to a simulated payment: read it, code it, check it, route it to the right approvers, pay it, and show afterward who did what. Six roles use it, and each sees only what the role allows, enforced on the server.

## Scoring, and what it changes

| Criterion | Weight | What it means for the build |
| -- | -- | -- |
| Required features | 40% | Tested on a hidden invoice batch. Rules must be general: no vendor names, file names or invoice numbers in code. A wrong hold on a normal invoice costs as much as a missed problem. |
| Technical depth | 25% | Live Q&A with every team member. Each rule is a small pure function with a table test and a one-sentence reason. Nothing clever that cannot be explained. |
| UI | 20% | A first-time user in each role finishes the role's task without help. Every flag reads as a sentence with the numbers in it. |
| Bonus | 15% | Scored only if the required nine work. Two bonus features, built deep (PLAN.md). |

Presentation is 2 to 4 minutes, then Q&A. Brim runs a workshop Sat Nov 21, 12:00 to 1:00pm, Trottier: the place to ask the open questions at the end of this file.

## Rules that frame everything

1. **The server decides.** Every read and every change goes through one guard. The UI hides things with the same matrix, but a direct call as the wrong role returns 403.
2. **Nobody approves an invoice they requested.** It escalates to their manager.
3. **Anyone who approved an invoice cannot release its payment.** This includes approving as a delegate.
4. **A delegate's action is recorded as a delegate's action**: who acted, on whose behalf.
5. **The model reads, code decides.** Claude transcribes what is printed. Parsing, arithmetic, matching, flags and routing are deterministic code.
6. **Bad input never crashes and never passes silently.** Every file ends in a named state with a reason.
7. **The audit log is append-only**, written in the same transaction as the change it records.
8. **Every flag carries its evidence**: the two values compared and where each came from.

## Non-goals

* Real authentication. Login is a user picker (PLAN.md). In production it would be SSO; the permission layer would not change.
* Real payments, real bank files, real email polling. The inbox is `emails.json` or an upload.
* Bonus ideas other than fraud alerts and bank reconciliation (PLAN.md): no natural-language spend questions, no approval recommendation, no Slack or phone approval, no journal export, no early-payment optimiser.
* Applying a credit note against a payment. Credit notes are captured, linked to their invoice and shown as an open credit on the vendor.
* Creating partial payments. History has three invoices paid in two instalments; they import and display, but the app pays an invoice in one payment.
* Merging duplicate vendor records. Lookalike vendors are flagged, not merged.
* Capital asset handling. The chart of accounts has no asset account for equipment.

## Decisions already made

| Decision | Why | Source |
| -- | -- | -- |
| Next.js App Router (TypeScript), Prisma, Postgres | Team choice | PLAN.md |
| Vercel + Neon, one shared database, files in Vercel Blob | Judges get a URL; team shares data | PLAN.md |
| Pick-a-user login, signed cookie session | Judges switch roles instantly | PLAN.md |
| Claude Sonnet (`claude-sonnet-5-5`) reads each PDF or image; Claude Haiku labels emails; load the `claude-api` skill before writing either call | Handles scans and French in one path | PLAN.md |
| All nine required features end to end; extraction, validation, duplicates and approvals built deep | Hidden batch rewards accuracy | PLAN.md |
| Bonus: fraud alerts, then bank reconciliation | Both reuse the checks engine | PLAN.md |
| Pipeline order: intake, extract, normalize, validate, dedupe, code, route | | PLAN.md |
| Invoice states: received, extracted, needs_review, coded, pending_approval, approved, scheduled, released, paid, plus rejected, on_hold, duplicate, void | | PLAN.md |
| Audit rows hash-chained | Tamper evidence | PLAN.md |
| The model returns values as printed; code parses numbers and dates | French amounts (`1 014,18 $`) are parsed by a rule that can be shown, not by the model | New here |
| Field confidence is computed from evidence, not reported by the model | A model's own confidence is not evidence. See Extraction | New here |
| Vendor is resolved by tax number, then bank account, then name | Two pairs of vendors share an email address and a bank account; tax numbers are unique | Dataset |
| Delivery province is the province of the bill-to address | Invoices print one of four Harborline offices; nothing else on the page says where delivery was | Dataset |
| Department comes from the PO, else from the vendor's history; requester stays empty unless a PO or an uploader supplies one | Invoices and emails name no requester | Dataset |
| One person cannot fill two steps of one chain; the later step moves up to that person's manager | The on-leave Facilities manager's delegate is the Finance Manager | New here |
| When nobody is allowed to release a payment, the app says so and blocks; it never relaxes rule 3 | The starter policy can produce this | New here |
| Card and cheque payments are simulated alongside EFT | 7 vendors have no bank details and are paid by card; 3 are paid by cheque | Dataset |
| The checks engine also runs over the ten months of history | Gives exact expected counts to test against, and a "History review" page for the demo | New here |
| "Today" comes from one helper reading `APP_TODAY` | The dataset's as-of date is 2026-11-02; judging is three weeks later | New here |
| Thresholds live in the policy table or one `config.ts`, never as literals in rules | The admin can edit rules; Q&A can point at one file | New here |
| Tailwind + shadcn/ui | PLAN.md names no UI kit | New here |

## Where the dataset adjusts PLAN.md

PLAN.md was written before the dataset landed.

| PLAN.md says | Dataset shows | Effect |
| -- | -- | -- |
| ~450 historical invoices, ~600 card transactions | 426 invoices, 809 lines, 590 card transactions | Seed check uses the exact counts below |
| Vendor status active / pending / hold / blocked | `active`, `pending_review`, `on_hold` | Use the three dataset values |
| Coding by TF-IDF / kNN over history, vendor default as fallback | The vendor's default account is right on 799 of 809 lines | Order is: same description at this vendor, vendor default, nearest description across vendors. The last matters only for unknown vendors |
| Per-field confidence from the model | 40 of the 41 unsealed files have a text layer | Confidence comes from text-layer agreement and arithmetic. See Extraction |
| Credit notes link to the original | History has no credit notes; the unsealed batch has one | Tests need the incoming one plus synthetic cases |
| Arithmetic checks | History arithmetic is clean on all 426 invoices | Same |
| Requester ≠ approver | Documents carry no requester | Requester is known only through a PO or an employee upload |

## What the dataset holds

### Tables

| File | Rows | Notes |
| -- | -- | -- |
| users | 40 | 28 employee, 6 approver, 2 ap_clerk, 2 controller_admin, 1 finance_manager, 1 auditor |
| departments | 8 | each with a manager and an annual budget |
| approval_policies | 13 | free-text conditions; P01–P08 approval, P09–P11 release, P12–P13 matching |
| gl_accounts | 30 | 25 expense accounts are used by history |
| tax_codes | 6 | HST13, GST5, PST7_BC, QST9975, EXEMPT, FOREIGN |
| vendors | 56 | 52 active, 3 pending_review, 1 on_hold; 52 Canadian, 4 US |
| bank_change_history | 9 | 8 verified by callback, 1 not |
| contracts | 27 | 17 fixed monthly, 5 rate card, 2 retainer, 3 blanket; 1 expired |
| purchase_orders | 52 | 45 closed, 6 open, 1 partially invoiced; all CAD |
| invoices | 426 | 394 paid, 18 scheduled, 12 rejected, 2 approved; 392 CAD, 34 USD |
| invoice_lines | 809 | 711 services, 98 goods; 1 to 7 lines per invoice |
| approvals | 474 | 462 approved, 12 rejected; 426 dept_manager steps, 48 finance_manager steps |
| payments | 415 | 326 EFT, 67 card, 22 cheque; 377 settled, 20 outstanding, 18 scheduled |
| bank_statement | 354 | all debits |
| card_transactions | 590 | 526 employee card, 64 AP virtual card |
| fx_rates | 306 | daily USD to CAD, 2026-01-01 to 2026-11-02 |
| incoming_invoices | 56 files | 54 PDF, 2 PNG; 15 sealed |
| inbox/emails.json | 59 | 54 with one attachment, 1 with two, 4 with none; received 2026-10-20 to 2026-11-02 |

### The people who matter to routing

| User | Role | Limit (CAD) | Note |
| -- | -- | -- | -- |
| U001 Priya Raman, CFO | controller_admin | 500,000 | Top of the tree; manages D08 Executive; the `cfo` step |
| U002 Marcus Webb, Controller | controller_admin | 250,000 | Manages D04 Finance |
| U003 Elise Tremblay, Finance Manager | finance_manager | 50,000 | The only finance manager; reports to U002 |
| U004, U005 | ap_clerk | 0 | Prepared all 415 payments |
| U006 | auditor | 0 | |
| U007–U012 | approver | 10,000 | Managers of D01, D02, D03, D05, D06, D07; all report to U001 |
| U012 Liam O'Connor, Facilities (D07) | approver | 10,000 | **On leave since 2026-10-20, delegate U003** |
| U015 Noah Park | employee | 0 | **Terminated 2026-09-15**; requester on older invoices |

Consequences, each one a test:

* Every D07 invoice in the incoming batch routes to U003 as delegate for U012. History has no D07 invoice after 2026-10-15, so the incoming batch is the first time delegation runs.
* A D07 invoice over $10,000 needs the department manager and the finance manager. Both resolve to U003. The second step moves up to U002. U003 and U002 have then both approved, so only U001 may release.
* Whenever U003 approves, U003 cannot release. History agrees: all 46 released payments on invoices U003 approved were released by U002 (44) or U001 (2).
* An invoice over $250,000 is approved by U003, U002 and U001, who are the only three people with release rights. Nobody can release it. History never gets there (largest invoice is $28,377.22), but the policy editor can. See Risks.

### What is planted in the history

The engine must reproduce these counts when run over history, or explain the difference.

| Mess | Found | Check |
| -- | -- | -- |
| Same vendor and invoice number entered twice | 5 pairs. 2 caught by the approver ("Duplicate - already submitted"). 2 paid twice (AP-00023/00034, AP-00215/00224). 1 scheduled twice for 2026-11-02 (AP-00394/00407) | DUP_EXACT |
| Same invoice, reformatted number | 2 pairs, both paid twice: `000604` / `604` (AP-00073/00077), `FA-001655` / `1655-A` (AP-00136/00155) | DUP_NEAR |
| Invoice paid by EFT and also charged to an employee card | 6 card charges: CT-00017, CT-00026, CT-00318, CT-00383 (Paper Trail), CT-00324, CT-00551 (Alpenglow), each equal to an invoice total, 7 to 36 days after the invoice date | DUP_PAID_BY_CARD |
| Split to stay under $10,000 | AP-00200/00206/00207: one vendor, two days, $14,070.00 together, no PO though the vendor requires one. AP-00129/00131: one vendor, two days, $14,236.36, two POs | SPLIT_SUSPECTED |
| Approver approved their own request | U010 on AP-00092, AP-00178, AP-00235 | SELF_APPROVAL |
| Wrong tax for the province | AP-00253: Alberta, 13% HST charged ($688.66). AP-00325: Ontario, no tax on $2,150.00. AP-00098: Quebec, GST only, no QST | TAX_WRONG_FOR_PROVINCE |
| Fixed monthly fee exceeded | 13 invoices: 10 Redstone (a usage overage line every month), 1 Aurora Mobile ($2,343.50 vs $2,150.00), 2 Pinecone ($826.80 vs $780.00) | CONTRACT_FEE_MISMATCH |
| Monthly cap exceeded | C024 in February ($15,727.70 of $15,000), C027 in April ($12,969.94 of $9,000), C022 in June ($24,937.05 of $20,000) | CONTRACT_MONTHLY_CAP |
| Invoice above its PO | AP-00159 ($2,600.00 on a $2,321.43 PO), AP-00216 ($3,100.00 on $2,767.86); plus two POs billed twice by the duplicates above | PO_OVER_BALANCE |
| Vendor on hold, still paid | 2 invoices to V053 (both got a finance manager step) | VENDOR_ON_HOLD |
| Bank details changed without verification | BC-009: V004 Cascadia Cartage, 2026-10-27, by email, no callback. AP-00426 for V004 is approved and unpaid | BANK_CHANGE_UNVERIFIED |
| Lookalike vendor records | V001/V051 Polar Freight (same address, bank and email; different tax number). V002/V053 Great Lakes Carriers (same bank and email; V053 on hold). V026/V052 Harlow & Stern / Harlow and Stern (different address, bank, tax number and email domain; V052 has no history) | VENDOR_LOOKALIKE |
| Cheques | All 20 cheque payments marked outstanding have cleared on the statement. One cleared for $6,990.53 against a $6,990.48 payment | Reconciliation |
| Bank items with no payment | 10 monthly fees ($29.50), 6 wire fees ($15.00), 5 pre-authorised debits ($174.90, $396.44, $354.11, $166.70, $340.86) | Reconciliation |

Not present in history, so tests need the incoming batch or made-up cases: credit notes, arithmetic errors, hourly rate over cap, fuel surcharge over cap, unknown vendors, bank details on the document differing from the master, odd dates.

### What the unsealed incoming batch looks like

* 40 PDFs, one page each, all with a text layer (492 to 890 characters). 1 PNG scan, slightly skewed and grey, readable.
* Titles: `INVOICE` / `Invoice` (27), `TAX INVOICE` (10), `FACTURE` (2), `CREDIT NOTE` (1).
* Field labels vary by template: `Invoice #`, `Invoice No.`, `INV NO`, `Invoice Number`, `Facture n°`; `Date`, `Invoice date`, `DATE`, `Issued`; `Due date`, `Payment due`, `DUE`, `Due by`, `Échéance`; `Terms`, `Payment terms`, `TERMS`, `Conditions`; `PO #`, `PO REF`, `Your PO`, `Customer PO` (present on 6, all blank); `Credit note ref`.
* All dates are ISO. "Odd dates" in this batch means odd values, not odd formats.
* Tax lines: `GST (5%)`, `HST (13%)`, `PST (7%)`, `QST (9.975%)`, `TPS (5 %)`, `TVQ (9,975 %)`. French templates write amounts as `1 014,18 $`.
* Totals: `Total CAD` (38), `Total USD` (2).
* Bill-to is always one of four offices, and that is the only statement of where delivery was:

| Bill-to address | Province |
| -- | -- |
| 88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8 | ON |
| 1055 W Hastings St, Suite 900, Vancouver BC V6E 2E9 | BC |
| 250 6 Ave SW, Suite 700, Calgary AB T2P 3H7 | AB |
| 1250 Rene-Levesque O, Bureau 2200, Montreal QC H3B 4W8 | QC |

* Remittance: `Inst. NNN Transit NNNNN Acct NNNNNNNN[N]` on 36; `Pay by credit card at our online portal.` on 4. Of the 36, 34 are from vendors in the master and none of those differs from it.
* One invoice prints `2/10 Net 30` and "2% discount if paid within 10 days."
* No document and no email names a requester or a department.
* Emails: bodies are one or two generic sentences. The subject's language does not predict the invoice's language. Two senders are not in the vendor master. One sender uses a lookalike domain. The four emails without attachments are a statement of account, a payment chase for an invoice that is already paid (AP-00049), an "invoice attached" with nothing attached, and a marketing newsletter.

**Trap:** the 17 fixed-fee vendors bill once per calendar month in history, on a different day each month. Eight unsealed invoices are a second October bill from such a vendor. One is a real duplicate (it reuses a September invoice number) and one bills a different service. The other six are the usual amount under the next number in the vendor's sequence: the next normal bill. "Same vendor, same total, within a month" must not raise a duplicate.

## Roles and permissions

One matrix in `src/lib/auth/permissions.ts`. The guard and the UI both read it.

| Action | Employee | AP Clerk | Approver | Finance Mgr | Controller | Auditor |
| -- | -- | -- | -- | -- | -- | -- |
| Read invoices | own submissions | all | own department, plus steps assigned to them | all | all | all |
| Upload an invoice | own department | yes | | | | |
| Ingest the inbox | | yes | | | | |
| Edit extracted fields and coding | | yes | | | | |
| Resolve data and policy flags | | yes | | | | |
| Resolve fraud flags | | | | yes | yes | |
| Submit for approval | | yes | | | | |
| Approve or reject | | | own step | own step | own step | |
| Set own delegate | | | yes | yes | yes | |
| Prepare and schedule a payment | | yes | | | | |
| Release a payment | | | | up to $100,000 | any amount | |
| Read vendors | names | yes, bank last 4 | yes, no bank | yes | yes | yes |
| Onboard a vendor, request a bank change | | yes | | | | |
| Approve a vendor, verify a bank change | | | | yes | yes | |
| Edit policies, users, roles | | | | | yes | read |
| Department spend | | | own department | all | all | all |
| Audit log and export | | | | | yes | yes |

Checked after the matrix, inside the service functions, for every role:

| Rule | Error |
| -- | -- |
| The actor is not the invoice's requester | `SELF_APPROVAL` |
| The actor is the person the current step is assigned to | `NOT_YOUR_STEP` |
| The actor did not approve this invoice, in their own name or as a delegate | `APPROVER_CANNOT_RELEASE` |
| The payment is within the actor's release limit | `RELEASE_LIMIT` |
| The actor did not request the vendor or bank change they are approving | `FOUR_EYES` |
| The actor's role is not auditor, for any change | `READ_ONLY_ROLE` |

## Pipeline

```
email or upload
  └─ intake        store file (SHA-256), label the email, one draft per attachment
       └─ extract      Claude reads the file → values as printed (cached by hash)
            └─ normalize   parse numbers, dates, tax labels, terms; compute field evidence
                 └─ resolve     vendor, bill-to province, PO, contract, credit-note target
                      └─ validate    checks → flags with evidence
                           └─ dedupe      against history, the batch, and card charges
                                └─ code        GL account, department, line type, with reasons
                                     └─ route       policy rules → ordered steps → people
```

Each stage is a pure function from the previous stage's output plus reference data to its own output. `run.ts` calls them in order and stores each output, so any stage can be re-run after a clerk edits a field.

### Intake

| Email | Label | What happens |
| -- | -- | -- |
| Has attachments | by document type after extraction | One draft per attachment. One email in the batch has two |
| No attachment, body says one is attached | `missing_attachment` | "Needs attention" queue, reason shown |
| No attachment, asks about a payment | `payment_inquiry` | Linked to the invoice by vendor and number; the row shows its payment status |
| No attachment, statement of account | `statement` | Filed against the vendor |
| Anything else | `other` | Ignored queue, reason shown |

Haiku labels only the emails without attachments. Emails with attachments are labelled by what the attachment turns out to be.

The same SHA-256 arriving twice does not create a second draft; the second arrival points at the first.

The intake page accepts loose files, or an `emails.json` together with its attachment files. Either way the hidden batch can be dropped in.

### Extraction

One call per file, PDF or image sent as is, forced to answer through this schema. Every value is a string exactly as printed.

```ts
interface Extracted {
  docType: 'invoice' | 'credit_note' | 'statement' | 'other';
  language: 'en' | 'fr';
  vendor: { name: string | null; address: string | null; gstHstNumber: string | null; qstNumber: string | null };
  billTo: { name: string | null; address: string | null };
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  terms: string | null;
  poNumber: string | null;
  creditNoteRef: string | null;
  currency: string | null;
  lines: Array<{ description: string; quantity: string | null; unitPrice: string | null; amount: string | null }>;
  subtotal: string | null;
  taxes: Array<{ label: string; amount: string }>;
  total: string | null;
  remit: { institution: string | null; transit: string | null; account: string | null; text: string | null };
  notes: string[];        // anything else printed, e.g. a discount line
  unreadable: string[];   // field names the model could not read
}
```

Field evidence, computed in code, shown beside each field in review:

| Signal | How | Result |
| -- | -- | -- |
| Text layer | When the PDF has one, each extracted value must appear in it after normalising spaces | `confirmed` or `not in text` |
| Arithmetic | quantity × unit price = amount; lines sum to subtotal; subtotal + taxes = total | Confirms the numbers when all three close |
| Second read | Only for files with no text layer whose arithmetic does not close: read once more and compare | Fields that differ are `uncertain` |

An invoice with any `uncertain` or `unreadable` required field goes to `needs_review` with those fields highlighted. An arithmetic failure that both reads agree on is a real error on the document, raised as a flag, not a reading problem.

Files that cannot be read at all (zero bytes, corrupt, password-protected, not an invoice, blank) end as `needs_review` with `UNREADABLE` or as a non-invoice with its label. No exception reaches the user.

### Normalisation

| Field | Rule |
| -- | -- |
| Amounts | Strip `$` and spaces. A comma followed by exactly two digits at the end is a decimal comma; any other comma is a thousands separator. Keep the sign. `Decimal`, never float |
| Dates | ISO first; then `DD/MM/YYYY`, `MM/DD/YYYY` and month names in English and French. A date that parses two ways raises `DATE_AMBIGUOUS` |
| Tax label | `HST`/`TVH` → HST13; `GST`/`TPS` → GST5; `PST`/`TVP` → PST7_BC; `QST`/`TVQ` → QST9975. The printed rate is kept beside it |
| Terms | `Net N` → N days; `Due on receipt` → 0; `2/10 Net 30` → 30 days with a 2%-in-10-days discount |
| Currency | From the total label (`Total CAD`, `Total USD`); fall back to the vendor's country |
| Invoice number | Kept as printed, plus `numberKey` (upper case, letters and digits only, no leading zeros) and `digitsKey` (digits only, no leading zeros) |
| FX | USD converts at the `fx_rates` row for the invoice date. A date past the last row uses the last row and raises `FX_RATE_FALLBACK` |

### Resolution

**Vendor**, in order, stopping at the first hit:

1. GST/HST number on the document equals a master record's. All 51 tax numbers in the master are unique.
2. Bank account on the document equals a master record's and the names are similar.
3. Normalised name equals a master name (lower case, punctuation removed, `&` → `and`, legal suffixes `inc`, `incorporated`, `ltd`, `limited`, `llp`, `co` removed).
4. No hit → `VENDOR_UNKNOWN`. The closest names are offered, never chosen.

The sender's email address is not used to pick the vendor. It is compared afterward (see fraud alerts).

**Province**: the province of the bill-to address. Not one of ON, BC, AB, QC → `SHIP_TO_UNKNOWN`, clerk picks.

**PO**: the printed PO number if any. If the vendor requires a PO and none is printed, list that vendor's open POs whose remaining balance covers the subtotal as suggestions.

**Contract**: the vendor's contract, if it has one. Each vendor has at most one.

**Department**: the PO's department; else the department this vendor billed most often to this province; else the vendor's most frequent department; else none and the clerk picks. Tested on history by leaving each invoice out: vendor alone is right 375 of 425 times, vendor plus province 368 of 394.

**Requester**: the PO's requester, or the employee who uploaded. Otherwise empty. History cannot supply it (vendor plus province predicts the requester 203 of 394 times). A requester who is terminated is replaced by their manager and raises `REQUESTER_TERMINATED`.

**Line type** (goods or services, needed for BC PST): from the account the line is coded to. Every account in history is all goods or all services except 5020 and 6630, where the description decides by its nearest match in history.

## Checks

Each check is one function `(invoice, refs) => Flag[]`. A flag has a code, a class, an effect, a sentence, and evidence.

* Class `data`: the document or the reading is wrong. The clerk corrects the field and the check re-runs.
* Class `policy`: the document breaks a rule. The clerk may override with a reason; an override adds a finance manager step.
* Class `fraud`: only a finance manager or controller resolves it.
* Effect `hold`: the invoice cannot be paid while the flag is open. Effect `route`: adds an approval step. Effect `info`: shown, changes nothing.

| Code | Fires when | Class / effect | Seen |
| -- | -- | -- | -- |
| `UNREADABLE` | No usable extraction | data / hold | |
| `FIELD_UNCERTAIN` | A required field is `uncertain` or missing | data / hold | |
| `ARITHMETIC_LINE` | quantity × unit price ≠ amount, beyond $0.02 | data / hold | Unsealed: 24 × $150.00 printed as $3,800.00 |
| `ARITHMETIC_SUBTOTAL` | Lines do not sum to the subtotal | data / hold | |
| `ARITHMETIC_TOTAL` | Subtotal + taxes ≠ total | data / hold | Unsealed: $3,180.00 + $159.00 printed as $3,439.00 |
| `DATE_ODD` | Due before invoice date; invoice date after the day it was received; invoice date more than 60 days before it was received; due date ≠ invoice date + printed terms | data / info, or hold when the date is in the future | Unsealed: dated 2026-08-12, received 2026-10-29 |
| `TERMS_MISMATCH` | Printed terms ≠ the vendor's `payment_terms_days`. History: due − invoice date equals the vendor's terms on all 426 | policy / info | |
| `VENDOR_UNKNOWN` | No vendor resolved | policy / hold | Unsealed: Blue Heron Couriers, Zephyr Data Services Inc. |
| `VENDOR_PENDING` | Vendor status `pending_review` | policy / hold + route (P05) | Unsealed: V054 |
| `VENDOR_ON_HOLD` | Vendor status `on_hold` | fraud / hold | History: 2 |
| `VENDOR_NEW` | Vendor has no approved invoice yet | policy / route (P05) | V052, V054–V056 |
| `VENDOR_LOOKALIKE` | Another vendor has the same normalised name and a different tax number or bank account, and one of the two has little or no history | fraud / hold | Unsealed: `Harlow and Stern LLP` (V052) |
| `TAX_NUMBER_MISMATCH` | Name resolves to a vendor whose tax number differs from the printed one | fraud / hold | |
| `BANK_MISMATCH` | Bank details on the document ≠ the vendor's current account | fraud / hold | |
| `BANK_CHANGE_UNVERIFIED` | The vendor's latest bank change has no callback verification | fraud / hold | V004; unsealed scan |
| `BANK_CHANGE_RECENT` | Bank details changed in the 30 days before the invoice date | fraud / info | |
| `TAX_WRONG_FOR_PROVINCE` | The tax codes charged are not the ones the table below expects | policy / hold | History: 3. Unsealed: HST billed to Alberta; PST on services in BC; no QST in Quebec; no tax in Ontario |
| `TAX_AMOUNT` | Right code, amount ≠ base × rate beyond $0.02 | data / hold | |
| `TAX_NOT_REGISTERED` | No tax charged and no tax number on the document or the master | policy / info | Unsealed: V054 |
| `CURRENCY_UNEXPECTED` | Currency differs from the contract's, or USD from a Canadian vendor. History: every USD invoice is from one of the 4 US vendors | policy / info | |
| `PO_REQUIRED_MISSING` | Vendor requires a PO, none printed (P13) | policy / hold | Unsealed: 7; an open PO covers the subtotal for 4 of them |
| `PO_NOT_FOUND` | Printed PO does not exist | policy / hold | |
| `PO_VENDOR_MISMATCH` | PO belongs to another vendor | policy / hold | |
| `PO_CLOSED` | PO status is closed | policy / hold | |
| `PO_OVER_BALANCE` | Subtotal > PO amount − subtotals already invoiced on it (P12). PO amounts are pre-tax: they equal the subtotal on 18 single-invoice POs and the total on 1 | policy / route to finance manager | History: 2 |
| `CONTRACT_EXPIRED` | Invoice date after the contract's end date | policy / hold | Unsealed: V044, C025 ended 2026-06-30 |
| `CONTRACT_FEE_MISMATCH` | Fixed monthly contract, subtotal ≠ monthly fee. The sentence says how many earlier invoices were over as well | policy / route | History: 13. Unsealed: $2,343.50 vs $2,150.00; $8,200.00 vs $1,320.00 |
| `CONTRACT_RATE_OVER_CAP` | Contract has an hourly cap; a line with quantity above 1, or the word "hours", has a unit price above it | policy / hold | |
| `CONTRACT_FUEL_OVER_CAP` | Fuel surcharge ÷ shipment lines > the cap. The base is the `LTL shipment` lines only: in history the printed percentage reproduces from those and not when detention is included | policy / hold | Unsealed: 22% against a 12% cap |
| `CONTRACT_MONTHLY_CAP` | This invoice takes the vendor's month over `not_to_exceed_monthly` | policy / route | History: 3. Unsealed: Redline October, $9,946.54 of $9,000 |
| `CONTRACT_PERIOD_REPEAT` | Second invoice in a calendar month from a fixed-fee vendor | policy / info only (see Trap) | Unsealed: 8 |
| `SPLIT_SUSPECTED` | Same vendor, two or more invoices within 5 days, each at or under an approval threshold, together over it | policy / route as the combined amount | History: 2 groups. Unsealed: three on 2026-10-28, $14,543.10 together |
| `REQUESTER_TERMINATED` | Requester's status is terminated | policy / info, reassigned | |
| `CREDIT_NOTE_ORPHAN` | Credit note whose reference matches no invoice of that vendor | policy / hold | |

Expected tax, by bill-to province. 801 of 809 history lines follow it; the other 8 are the three wrong-tax invoices.

| Bill-to | Services | Goods |
| -- | -- | -- |
| ON | HST 13% | HST 13% |
| AB | GST 5% | GST 5% |
| BC | GST 5% | GST 5% + PST 7% |
| QC | GST 5% + QST 9.975% | GST 5% + QST 9.975% |
| Insurance vendor, any province | exempt | |
| US vendor, any province | no Canadian tax | |

QST is on the pre-tax amount. On an invoice with both goods and services delivered to BC, PST applies to the goods lines only. The vendor's own province does not matter.

Posting shown on the invoice screen: expense accounts for the lines, with BC PST added to the goods lines' cost because it is not recoverable; 1160 for GST/HST; 1165 for QST; 2100 for the total.

## Duplicate detection

Runs against every invoice already in the database, whatever its state, and against the rest of the batch. Vendors flagged as lookalikes of each other count as one vendor here.

| Layer | Match | Result |
| -- | -- | -- |
| `DUP_FILE` | Same SHA-256 | Second arrival is not created |
| `DUP_EXACT` | Same vendor, same `numberKey`. **Date is not compared**: two of the three unsealed duplicates carry a new date | fraud / hold |
| `DUP_NEAR` | Same vendor, same `digitsKey`, total within $1.00 | fraud / hold |
| `DUP_CONTENT` | Same vendor, different number, same total, invoice dates within 3 days, and the same set of line amounts | fraud / hold |
| `DUP_PAID_BY_CARD` | An employee-card charge whose merchant equals the vendor's name upper-cased and cut to 22 characters, amount equal to the invoice total, posted from 5 days before to 45 days after the invoice date | fraud / hold |

The review screen puts the suspected original beside the new one: number, date, total, lines, state, and how it was paid. Confirming sets the invoice to `duplicate`. Rejecting the match needs a reason, and when the original is already paid only a finance manager or controller may do it.

## Smart coding

For each line, in order:

1. The same description at this vendor in history → that account. Covers the one real split in the data: `Racking components` goes to 5030 at three packaging vendors whose default is 5040, 10 lines of 10.
2. The vendor's default account. Right on 799 of 809 history lines.
3. Unknown vendor: the nearest description across all history by shared words (350 freight lines make `LTL shipment …` unambiguous).

The reason is stored with the suggestion and shown: "Paper Trail Office Supply: 16 of 16 past lines coded 6210 Office Supplies (vendor default)". Department follows Resolution. The clerk accepts or changes each line; a change is audited with both values.

Report two numbers from history, trained on January to August and tested on September and October: account right on first suggestion, department right on first suggestion.

## Approval routing

### Policy rows

The 13 CSV conditions are free text. The seed maps each `rule_id` by hand to a structured row and keeps the original text for display.

```ts
type StepRole = 'dept_manager' | 'finance_manager' | 'controller_admin' | 'cfo';   // ranked in this order

type Condition =
  | { field: 'totalCad'; op: 'gt' | 'lte'; value: number }
  | { field: 'vendor.status'; op: 'in'; value: string[] }
  | { field: 'vendor.isNew'; op: 'eq'; value: boolean }
  | { field: 'vendor.category'; op: 'in'; value: string[] }
  | { field: 'vendor.requiresPo'; op: 'eq'; value: boolean }
  | { field: 'department'; op: 'in'; value: string[] }
  | { field: 'flag'; op: 'in'; value: string[] };          // an open or overridden flag code

type Effect =
  | { kind: 'requireSteps'; steps: StepRole[] }
  | { kind: 'hold'; flag: string }
  | { kind: 'releaseBy'; roles: Role[]; maxCad: number | null }
  | { kind: 'invariant'; name: 'noSelfApproval' | 'delegateWhenOnLeave' | 'approverCannotRelease' };

interface PolicyRule { id: string; type: 'approval' | 'payment_release' | 'match'; active: boolean; locked: boolean;
                       when: Condition[]; effect: Effect; sourceText: string; note: string }
```

| Rule | when | effect |
| -- | -- | -- |
| P01 | total ≤ 10,000 | require dept_manager |
| P02 | total > 10,000 | require dept_manager, finance_manager |
| P03 | total > 50,000 | require dept_manager, finance_manager, controller_admin |
| P04 | total > 250,000 | require dept_manager, finance_manager, controller_admin, cfo |
| P05 | vendor status `pending_review`, or vendor is new | require finance_manager |
| P06 | vendor category Legal | require finance_manager |
| P07 | always | invariant noSelfApproval, locked |
| P08 | always | invariant delegateWhenOnLeave, locked |
| P09 | payment ≤ 100,000 | releaseBy finance_manager, controller_admin |
| P10 | payment > 100,000 | releaseBy controller_admin |
| P11 | always | invariant approverCannotRelease, locked |
| P12 | flag `PO_OVER_BALANCE` | require finance_manager |
| P13 | vendor requires a PO and none is present | hold `PO_REQUIRED_MISSING` |

"Total" is the CAD total including tax. History confirms it: the 48 invoices with a finance manager step are exactly the 43 over $10,000 including tax, 3 legal invoices under it, and 2 to the on-hold vendor.

P07, P08 and P11 are the brief's rules for every role. The editor shows them and does not let them be switched off.

### From rules to people

1. Collect the step roles required by every active approval rule whose conditions hold. Add `finance_manager` when any policy or fraud flag was overridden. Remove repeats, sort by rank.
2. Resolve each role: `dept_manager` → the manager of the invoice's department; `finance_manager` → the user with that role; `controller_admin` → the controller who is not the CFO; `cfo` → the controller with no manager.
3. Self-approval: if the person is the invoice's requester, replace with that person's manager.
4. Leave: if the person is `on_leave`, replace with their delegate and store `onBehalfOf`. The step keeps the absent person's limit.
5. Terminated: replace with their manager.
6. Repeats: if the person already holds an earlier step of this chain, replace with their manager.
7. If a replacement has nobody to go to, the step is `unresolvable` and the invoice is held with the reason.
8. Every step stores why: the rule ids, and each replacement made.

The route preview shows this before the clerk submits, and the policy editor uses the same function to preview a draft rule set against any invoice.

### Worked examples

| Case | Chain | Who may release |
| -- | -- | -- |
| D01 invoice, $4,743.80 | U007 | U003, U002 or U001 |
| D07 rent invoice, $18,758.00 (unsealed, V036) | U003 for U012 on leave; finance manager step moves from U003 to U002 | U001 only |
| Legal invoice from an established vendor, $339.52, D08 | U001; U003 (P06) | U002 only |
| Invoice requested by U010, IT, $2,700 | dept_manager is U010 → U001 (P07) | U003 or U002 |
| D04 invoice, $60,000 | U002; U003; controller step is U002 again → U001 | Nobody: all three have approved. Held with that reason |

Steps are decided in order. A rejection ends the chain; the invoice is `rejected` and the clerk may reopen it to `needs_review`. Rejection reasons offered are the five in history: pricing does not match quote, goods not received, duplicate, wrong cost centre, coding incorrect.

## Payments

* **Prepare** (AP clerk): an approved invoice with no open hold becomes a scheduled payment. Scheduled date defaults to the due date, as on all 415 history payments. Method is the vendor's preferred method.
* **Refused at prepare and again at release**: any open hold flag; vendor not `active`; the vendor's latest bank change unverified; EFT with no bank details; an invoice that already has a live payment.
* **Release** (finance manager up to $100,000, controller any amount, never an approver of the invoice): stores the releaser and a snapshot of the bank details paid to.
* **Simulate bank run** (button on the dashboard): released → sent → settled. Reference formats follow history: `BRIM-EFT-` + 8 digits, `BRIM-VC-` + 8 digits, `BRIM-CHQ-` + 8 digits. An EFT writes a bank statement line `EFT PMT ` + vendor name upper-cased and cut to 24 characters + space + the last 6 digits of the reference. A card payment writes a card transaction with source `ap_virtual_card`, card id `VC-<invoice id>` and memo `AP payment <invoice id>`. A cheque stays `sent` until a later run clears it. An EFT whose account is not 8 or 9 digits fails with a reason.
* **Invoice state** follows its payment: `scheduled` when prepared, `released` when released, `paid` when settled payments add up to the total.
* **Dashboard**: due this week, overdue, scheduled, awaiting release, failed, with amount by currency. Each row says who may release it.
* Day one, from the history as of 2026-11-02: 18 scheduled payments and 2 approved invoices. Two of the scheduled payments are the same invoice entered twice (AP-00394 and AP-00407, both due 2026-11-02), and one approved invoice is for the vendor whose bank change is unverified (AP-00426). The dashboard should open on those.

## Vendor management and bank changes

* Vendor list and detail. The detail page shows AP invoices and card charges at that merchant together.
* Onboarding (AP clerk) creates the vendor as `pending_review`. A finance manager or controller, not the person who created it, approves it to `active`. Invoices from a pending or on-hold vendor can be reviewed and coded but not paid.
* Bank details are versioned. The live account changes only when a change request is verified.
* A change request (AP clerk) records the old and new account, the channel, and who asked. Verifying it (finance manager or controller, not the requester) requires ticking "called the vendor back on the number already on file" and a note. Until then every payment to that vendor is held.
* The 9 history changes are imported as requests. BC-009 arrives unverified, so V004 starts held.

## Audit trail

```ts
interface AuditEvent {
  seq: bigint; at: Date;
  actorId: string; actorRole: Role; onBehalfOfId: string | null;
  action: string;                       // 'invoice.approve', 'payment.release', 'vendor.bank_change.verify', …
  entityType: string; entityId: string;
  invoiceId: string | null; paymentId: string | null; vendorId: string | null;
  before: Json | null; after: Json | null; reason: string | null;
  source: 'app' | 'history';
  prevHash: string; hash: string;       // sha256(prevHash + canonical JSON of the row)
}
```

* Written by the service function inside the transaction that makes the change. There is no update or delete path.
* The 474 history approvals and 415 history payments are imported as `history` events, so the audit pack works for old payments too.
* **Audit pack** for a payment, one screen: the payment, its invoice and document image, each approval with delegate information, the coding and posting, every flag and how it was resolved, the bank details paid to.
* Global log for controller and auditor, filtered by person, entity, action and date. CSV export.
* A "verify chain" action recomputes the hashes and reports the first row that does not match.

## Data model

Reference tables import one to one from the CSVs: `User`, `Department`, `GlAccount`, `TaxCode`, `Vendor`, `Contract`, `PurchaseOrder`, `FxRate`, `BankStatementLine`, `CardTransaction`. Ids are the dataset's ids. New invoices and payments continue the dataset's numbering.

```prisma
model Invoice {
  id                  String  @id                 // AP-00427 …
  source              String                      // history | inbox | upload
  kind                String                      // invoice | credit_note
  status              String
  heldFrom            String?                     // state to return to when the last hold closes
  version             Int     @default(1)         // optimistic lock for edits, approvals, release
  documentId          String?
  emailId             String?
  vendorId            String?
  vendorInvoiceNumber String?
  numberKey           String?
  digitsKey           String?
  invoiceDate         DateTime? @db.Date
  receivedDate        DateTime  @db.Date
  dueDate             DateTime? @db.Date
  currency            String?
  subtotal            Decimal?  @db.Decimal(14, 2)
  gstHstAmount        Decimal?  @db.Decimal(14, 2)
  pstQstAmount        Decimal?  @db.Decimal(14, 2)
  total               Decimal?  @db.Decimal(14, 2)
  fxRateToCad         Decimal?  @db.Decimal(10, 4)
  totalCad            Decimal?  @db.Decimal(14, 2)
  shipToProvince      String?
  departmentId        String?
  requesterId         String?
  poId                String?
  contractId          String?
  creditOfInvoiceId   String?
  extracted           Json?                       // the model's answer, as printed
  evidence            Json?                       // per field: confirmed | not in text | uncertain
  @@index([vendorId, numberKey])
  @@index([vendorId, digitsKey])
  @@index([vendorId, total])
}

model InvoiceLine { invoiceId, lineNo, description, quantity, unitPrice, amount, lineType,
                    glSuggested, glFinal, departmentSuggested, departmentFinal, reason Json,
                    gstHstCode, pstQstCode }
model InvoiceTax  { invoiceId, labelPrinted, taxCode, amount, expectedAmount }
model Flag        { id, invoiceId?, vendorId?, paymentId?, bankTxnId?, code, klass, effect,
                    status /* open | fixed | overridden | confirmed */, message, evidence Json,
                    resolvedById?, resolvedAt?, resolutionNote? }
model PolicyRule  { id, type, active, locked, when Json, effect Json, sourceText, note, updatedById? }
model ApprovalStep { id, invoiceId, stepNo, role, assignedToId, onBehalfOfId?, limitCad, why Json,
                     decision /* pending | approved | rejected */, decidedById?, decidedAt?, comment? }
model Payment     { id, invoiceId, vendorId, method, scheduledDate, paidDate?, currency, amount,
                    fxRateToCad, amountCad, discountTaken, reference, status, preparedById,
                    releasedById?, releasedAt?, failureReason?, bankSnapshot Json? }
model VendorBankAccount { id, vendorId, institution, transit, account, validFrom, validTo? }
model BankChangeRequest { id, vendorId, oldLast4, newInstitution, newTransit, newAccount, channel,
                          requestedById, requestedAt, status, verifiedById?, verifiedByCallback, note? }
model Document    { id, sha256 @unique, fileName, mime, bytes, url, textLayer? }
model InboxEmail  { id, fromName, fromAddress, subject, receivedAt, body, attachments Json,
                    label, labelReason, senderCheck Json? }
model AuditEvent  { /* as above */ }
```

Why it is shaped this way (the Q&A answer): amounts are decimals in the invoice's currency with the CAD value stored beside them, because limits are in CAD and the rate is the invoice date's; suggested and final coding are separate columns so every override is visible; flags are rows, not booleans, so each has evidence and a resolution; steps are rows created at submit time, so a later policy edit does not rewrite an invoice already in flight; bank accounts are versioned so a payment can show exactly what it paid to.

## Server API

Every route calls a service function `(actor, input)` that checks the matrix, checks the invariants, makes the change and writes the audit row in one transaction. Server actions, if used, call the same functions. Errors are `{ "error": { "code", "message", "details" } }`.

| Route | Who | Errors beyond 403 `FORBIDDEN` |
| -- | -- | -- |
| `POST /api/session` `{ userId }`, `DELETE /api/session`, `GET /api/me` | anyone | |
| `POST /api/intake/files` (many files) | employee, AP clerk | 422 `UNSUPPORTED_FILE` |
| `POST /api/intake/inbox` (`emails.json` + files) | AP clerk | 422 `BAD_INBOX_FILE` |
| `GET /api/inbox` | AP clerk and up, auditor | |
| `POST /api/invoices/:id/process` | AP clerk | 409 `ALREADY_PROCESSING` |
| `GET /api/invoices`, `GET /api/invoices/:id` | scoped by the matrix | 404 when out of scope |
| `PATCH /api/invoices/:id` (fields, lines, coding; `If-Match: version`) | AP clerk | 409 `VERSION_CONFLICT`, 409 `INVALID_STATE` |
| `POST /api/invoices/:id/flags/:flagId/resolve` `{ action, reason }` | by flag class | 403 `FLAG_CLASS`, 422 `REASON_REQUIRED` |
| `GET /api/invoices/:id/route-preview` | AP clerk and up | |
| `POST /api/invoices/:id/submit` | AP clerk | 422 `OPEN_FLAGS`, `CODING_INCOMPLETE`, `STEP_UNRESOLVABLE` |
| `POST /api/invoices/:id/approve`, `/reject` `{ comment }` | the step's assignee | 403 `NOT_YOUR_STEP`, `SELF_APPROVAL`; 409 `VERSION_CONFLICT` |
| `POST /api/invoices/:id/reopen`, `/void` `{ reason }` | AP clerk; controller | 409 `INVALID_STATE` |
| `POST /api/payments` `{ invoiceId, scheduledDate }` | AP clerk | 422 `NOT_APPROVED`, `OPEN_HOLD`, `VENDOR_NOT_PAYABLE`, `BANK_CHANGE_UNVERIFIED`, `NO_BANK_DETAILS`; 409 `ALREADY_SCHEDULED` |
| `POST /api/payments/:id/release` | finance manager, controller | 403 `APPROVER_CANNOT_RELEASE`, `RELEASE_LIMIT`; 422 `OPEN_HOLD` |
| `POST /api/payments/simulate-bank` | AP clerk, finance manager, controller | |
| `GET /api/payments?bucket=` | AP clerk and up, auditor | |
| `GET /api/vendors`, `GET /api/vendors/:id` | by the matrix; bank masked by role | |
| `POST /api/vendors` | AP clerk | 409 `VENDOR_EXISTS` (same tax number) |
| `POST /api/vendors/:id/approve`, `/hold`, `/release-hold` | finance manager, controller | 403 `FOUR_EYES` |
| `POST /api/vendors/:id/bank-changes` | AP clerk | |
| `POST /api/bank-changes/:id/verify`, `/reject` | finance manager, controller | 403 `FOUR_EYES`; 422 `CALLBACK_REQUIRED` |
| `GET /api/policies`, `PUT /api/policies/:id`, `POST /api/policies/preview` | controller; auditor reads | 422 `LOCKED_RULE`, `BAD_CONDITION` |
| `GET /api/users`, `PATCH /api/users/:id`, `PUT /api/me/delegation` | controller; own delegation for approvers and up | 422 `DELEGATE_INVALID` |
| `GET /api/spend?department=` | approver for own department; finance manager and up; auditor | |
| `GET /api/audit`, `/api/audit/pack/:paymentId`, `/api/audit/export.csv`, `/api/audit/verify` | controller, auditor | |
| `GET /api/history-review` | finance manager and up, auditor | |
| `GET /api/reconciliation`, `POST /api/reconciliation/:bankTxnId/explain` | AP clerk and up; auditor reads | |

## Screens

Navigation shows only what the role can open. Every role lands on its own work.

| Role | Lands on | Also has |
| -- | -- | -- |
| Employee | My submissions, each with its state in plain words | Submit an invoice (file, optional PO, note) |
| AP Clerk | Review queue, flagged items first | Inbox, Payments to prepare, Vendors, Reconciliation |
| Approver | Waiting for me | Department spend against budget, AP and card together; My delegate |
| Finance Manager | Waiting for me: approvals, fraud flags, vendor approvals, bank changes | Payments to release, History review |
| Controller | Same as finance manager | Policies, Users, Audit log |
| Auditor | Audit log, with a read-only banner | Everything, read-only; export |

**The invoice screen** is the same for every role, with actions by role. Left: the document. Right, top to bottom: state and next person; flags as sentences with their evidence and the action that resolves each; fields with their evidence marks; lines with suggested coding and the reason; posting; approval chain with the rule behind each step and delegate labels; payment; history. The brief asks for invoice, coding and approval history on one screen: this is it.

Flag sentences name both numbers and both sources. For example: "Tax: this invoice is billed to Alberta, where 5% GST applies ($110.86). The vendor charged 13% HST ($288.25)."

**Policy editor**: one row per rule, conditions and steps as dropdowns, locked rules shown as locked. "Try on an invoice" shows the chain before and after the draft.

**User picker**: grouped by role, each with name, title and department, so a judge can pick "an approver" without knowing names.

## Bonus

### Fraud alerts

Uses the checks above (`VENDOR_LOOKALIKE`, `BANK_MISMATCH`, `BANK_CHANGE_UNVERIFIED`, `BANK_CHANGE_RECENT`, `TAX_NUMBER_MISMATCH`) plus two on the email:

| Code | Fires when |
| -- | -- |
| `SENDER_DOMAIN_MISMATCH` | The sender's domain is not the resolved vendor's `ap_contact_email` domain |
| `SENDER_LOOKALIKE_DOMAIN` | The sender's domain is within a small edit distance of a known vendor's domain, or contains that vendor's name, without being it. Unsealed: `harlowandstern-llp.example` against `harlow.example` |

One "Fraud watch" page for finance manager and controller lists every open fraud flag across invoices, vendors and payments, with the amount at stake. An open fraud flag blocks release.

### Bank reconciliation

Match statement lines to payments in this order:

| Line | Match | History |
| -- | -- | -- |
| `EFT PMT … NNNNNN` | Last 6 digits = last 6 of the payment reference, amount equal | 313 of 313 |
| `CHEQUE NNNN CLEARED` | Cheque payments by amount, earliest unmatched first, cleared date after paid date. Ten cheques share $6,990.48, so order matters | 19 exact; 1 at $6,990.53 against $6,990.48 → `amount differs by $0.05` |
| `MONTHLY ACCOUNT FEE`, `WIRE FEE` | No payment; explained as bank fees, account 7010 | 10 and 6 |
| `PREAUTH DEBIT NNNNNN` | No payment and no rule → `unexplained`, needs a person | 5 |

Also listed: payments with no statement line (the 13 scheduled EFTs and 2 scheduled cheques, expected), and the 20 cheques the ledger still calls outstanding that the bank has cleared. "Mark explained" takes a note and is audited.

## Build order

Each phase ships its screens; UI is not left to the end. Clock targets follow PLAN.md: required features frozen Sat about 22:00, bonus overnight, fixes Sun morning.

| # | Phase | Size | Done when |
| -- | -- | -- | -- |
| 0 | Scaffold in `Brim/`, Neon, Vercel, env, Claude API key | 1 h | The deployed page reads a row from Neon |
| 1 | Schema, seed, history import | 2 h | Row counts equal the Tables section; history approvals and payments appear as audit events; the seed skips sealed files |
| 2 | User picker, matrix, guard, service layer, audit writer | 2 h | A table test calls every service function as every role and gets the matrix; chain verifies |
| 3 | Intake, extraction, normalisation | 3.5 h | 41 unsealed files become drafts; every text-layer value agrees or is marked; the scan reads; the broken inputs listed in Testing end in named states |
| 4 | Resolution, checks, duplicates | 3.5 h | History replay matches "What is planted"; unsealed results match "Unsealed batch: expected" or the difference is understood |
| 5 | Coding | 1.5 h | Two accuracy numbers printed; reasons on screen |
| 6 | Routing, approvals, delegation, policy editor | 3 h | The five worked examples pass as tests and in the browser |
| 7 | Payments, bank simulation, dashboard | 2.5 h | An invoice goes from approved to paid; the three release refusals are seen in the browser |
| 8 | Vendors, onboarding, bank changes | 2 h | V004 is held until a second person verifies; a new vendor cannot be paid until approved |
| 9 | Audit log, audit pack, export | 1.5 h | A history payment and a new payment both open a complete pack |
| 10 | Walk each of the six roles through its task on the deployed app | 3 h | Each role finishes without touching another role's screens |
| 11 | Sealed drill | 1 h + fixes | See Testing |
| 12 | Fraud watch, then reconciliation | 3 h | The lookalike domain is caught; the statement reconciles to the History column above |
| 13 | Q&A sheet, pitch notes, last check on the deployed build | 2 h | Final commit before Sun 12:00 |

About 31 hours of work in 37. If behind, cut in this order: reconciliation, the policy editor's preview, department spend, History review page. Do not cut the sealed drill or phase 10.

## Testing

**Seed**: counts equal the Tables section exactly.

**History replay**: the engine over the 426 history invoices produces the "What is planted" table. Any other hold-level flag on a history invoice is a false positive to look at before the hidden batch does.

**Unsealed batch: expected**, from a hand read of the 41 files. Treat a disagreement as something to investigate in either direction.

| File | Vendor | Expected |
| -- | -- | -- |
| `harlowsternllp_001468.pdf` | V026 | `DUP_EXACT` with AP-00389, paid; date moved from 2026-09-29 to 2026-10-06 |
| `cloudbarnsoftwar_INV01561.pdf` | V015 | `DUP_EXACT` with AP-00370, paid; date moved from 2026-09-09 to 2026-10-09 |
| `brightlinesafety-inv-032.pdf` | V013 | `DUP_NEAR` with AP-00330 (`583` vs `FA-000583`), paid; `DATE_ODD`; `PO_REQUIRED_MISSING` |
| `Invoice 287.pdf`, `orionstrategypar-inv-029.pdf`, `orionstrategypar_281.pdf` | V029 | `SPLIT_SUSPECTED`: three on 2026-10-28, $14,543.10; hourly rates $170, $215, $240 are under the $245 cap |
| `Invoice 000964.pdf` | V001 | `CONTRACT_FUEL_OVER_CAP`: 22% against 12%. Resolves to V001 by tax number although the sender address is shared with V051 |
| `Invoice AU26-2207.pdf` | V022 | `CONTRACT_FEE_MISMATCH`: $2,343.50 vs $2,150.00 |
| `latticeledgersys_557.pdf` | V019 | `CONTRACT_FEE_MISMATCH`: $8,200.00 vs $1,320.00 |
| `redlinefleetcard-inv-044.pdf` | V008 | `CONTRACT_MONTHLY_CAP`: October reaches $9,946.54 of $9,000 with AP-00424 |
| `torqueindustrial_1771.pdf` | V044 | `CONTRACT_EXPIRED`; `PO_REQUIRED_MISSING`. The vendor's only open PO, PO-2026-0037, has $1,800.00 left against a $2,150.00 subtotal, so it is not offered as a fit |
| `keystonerackings-inv-002.pdf` | V012 | `PO_REQUIRED_MISSING`, suggest PO-2026-0046 |
| `alpengloweventsc-inv-010.pdf` | V047 | `PO_REQUIRED_MISSING`, suggest PO-2026-0050 |
| `ironwoodpalletco-inv-048.pdf` | V010 | `PO_REQUIRED_MISSING`, suggest PO-2026-0051; `TAX_WRONG_FOR_PROVINCE`: Ontario, no HST |
| `Invoice 853.pdf` | V014 | `PO_REQUIRED_MISSING`, no open PO for this vendor |
| `riverbendcaterin_1739.pdf` | V054 | `VENDOR_PENDING`; `PO_REQUIRED_MISSING`, suggest PO-2026-0047; `TAX_NOT_REGISTERED` |
| `northboundcourie_000639.pdf` | V006 | `TAX_WRONG_FOR_PROVINCE`: Alberta, HST charged. Same vendor and same error as AP-00253 |
| `signalsparrowcre_000970.pdf` | V031 | `TAX_WRONG_FOR_PROVINCE`: BC PST on services |
| `beaumontrivieres_FA000557.pdf` | V027 | `TAX_WRONG_FOR_PROVINCE`: Quebec, no QST; finance manager step (Legal) |
| `evergreenenergyu_000850.pdf` | V041 | `ARITHMETIC_TOTAL` |
| `northstarmediabu_NO261773.pdf` | V032 | `ARITHMETIC_LINE` |
| `Invoice 4443.pdf`, `zephyrdataservic_7590.pdf` | none | `VENDOR_UNKNOWN` |
| `Invoice HA26-2766.pdf` | V052 | `VENDOR_LOOKALIKE`; `SENDER_LOOKALIKE_DOMAIN` |
| `greatlakescarrie-inv-025.pdf` | V002 | Credit note for −$672.00, linked to AP-00358. Resolves to V002, not on-hold V053, by tax number |
| `scan_8049.png` | V004 | `BANK_CHANGE_UNVERIFIED`; Quebec taxes and 7.07% fuel are correct |
| `Invoice 002935.pdf` | V036 | No flag. Chain: U003 for U012, then U002. Release: U001 only |
| `Invoice FA-000318.pdf`, `Invoice FA-002853.pdf`, `Invoice INV-00734.pdf`, `cloudbarnsoftwar-inv-047.pdf`, `sparkgridcrminc_FA002342.pdf`, `tesseraanalytics-inv-050.pdf` | | No hold. `CONTRACT_PERIOD_REPEAT` as info only. These are the six in the Trap |
| `granvillecommerc_GR262864.pdf`, `placemontroyalim-inv-053.pdf`, `greatlakescarrie-inv-016.pdf`, `harlowsternllp_001470.pdf`, `laurentianlogist_FA002399.pdf`, `papertrailoffice_2217.pdf`, `Invoice TR26-1042.pdf` | | No issue found on a hand read |
| `mapletireautofle-inv-009.pdf` | V009 | No flag. Billed to BC with GST only, which is right because history types "Tire service (units)" as a service on all 6 lines. A line-type mistake here would raise a false PST flag |
| Emails EM-056, EM-057, EM-058, EM-059 | | statement; payment inquiry linked to AP-00049; missing attachment; other |
| Email EM-029 | | Two drafts from one email |

**Rule tables**: every check has a table test with at least one firing and one non-firing case. The checks with no real example (bank mismatch, hourly cap, orphan credit note, ambiguous date, total over every limit) get made-up cases.

**Permissions**: the matrix test from phase 2, plus one test per invariant, each calling the service directly.

**Broken inputs**: zero-byte file, truncated PDF, password-protected PDF, blank image, a photo that is not an invoice, a two-page PDF, the same file twice. Each ends in a named state.

**Sealed drill**, once, at the required-feature freeze: drop the 15 sealed files and their emails into the deployed app through the intake page, the way a judge would. Read every result against the document. Fix what is wrong by fixing the rule, never by special-casing the file. Record how many of the 15 came through with the right fields, the right flags and no wrong hold; that number is the best estimate of the hidden-batch score.

## Q&A sheet

Write `Brim/docs/QA.md` in phase 13 with real file names and numbers. The answers it must hold:

| Question | Answer in one line |
| -- | -- |
| How are roles enforced? | One matrix, one guard in every service function, invariants checked after it; a test calls each function as each role |
| How are duplicates caught? | Four layers from file hash to card charges; number keys ignore formatting; date is deliberately not part of the exact match, and why; fixed-fee vendors are why "same total" alone is not a duplicate |
| How are mismatches caught? | One function per check, evidence on every flag, expected tax from the bill-to province |
| How does extraction handle bad input? | The model transcribes; code parses; three evidence signals; unreadable files end in a named state |
| Why this data model? | The paragraph under Data model |
| What breaks at 100 times the volume? | Extraction in the request → a queue and workers; duplicate search → the three indexes already on Invoice, plus trigram for names; one hash chain → a chain per day with anchors; coding counts recomputed per invoice → a table refreshed on write; lists → pagination; history replay → incremental |
| What did the app find in the history? | The "What is planted" table, with the dollar amounts paid twice |
| What is wrong with the starter policy? | Over $250,000, and over $50,000 in Finance or Executive, everyone who can release has approved |

## Risks and open questions

1. **How the hidden batch arrives.** Loose files, or an `emails.json` too? Run by the judges or by the team? The intake page takes both. Ask at the Brim workshop.
2. **No eligible releaser.** The starter policy produces it for large invoices. The plan blocks and explains. The alternative is to let the CFO release what the CFO approved, which breaks the brief's rule.
3. **Delegate who is also the next approver.** The plan moves the second step up to U002. The alternative is to let U003 approve once for both steps, which leaves a $18,758 invoice with one approver.
4. **Requester is unknown for most inbox invoices.** Rule 2 can only be checked when a PO or an uploader names one. If judges expect a requester on every invoice, the clerk assigns one in review.
5. **What counts as a new vendor.** The plan uses "no approved invoice yet". P05 does not define it.
6. **Fixed-fee contracts with a regular overage.** Redstone is over its fee in all 10 months. The plan flags it every time and says so in the sentence, rather than learning to ignore it.
7. **Line type decides BC PST** and is inferred from the account. A goods line coded to a services account will pass with no PST.
8. **Serverless time limits.** One extraction per request, driven from the browser three at a time. A second read doubles the time for the few scans.
9. **Shared database.** A reseed wipes teammates' test data. Agree with the team before reseeding once others are using the deployment.
10. **`APP_TODAY`.** Set to 2026-11-02 the demo matches the dataset; left unset, every incoming invoice is overdue by judging day.
