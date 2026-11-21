# Loop B progress: rules engine

Branch `loop/rules`. Spec: BUILD_PLAN.md (Roles and permissions, Resolution, Checks, Duplicate detection,
Smart coding, Approval routing). One item per loop run: implement, test, commit, tick.

Code lives in `src/lib/rules/` (resolution, checks, duplicates, coding, routing) and `src/lib/auth/permissions.ts`.
Scripts in `scripts/` set `APP_TODAY=2026-11-02` themselves.

## Items

- [x] 1. `scripts/verify-counts.ts`: verify every count in BUILD_PLAN "Tables"; log mismatches below
- [x] 2. Refs (reference data indexes) + history adapter (InvoiceRow + lines → ResolvedInvoice) + name/number key helpers
- [x] 3. Roles and permissions: matrix in `src/lib/auth/permissions.ts` + invariant checks (SELF_APPROVAL, NOT_YOUR_STEP, APPROVER_CANNOT_RELEASE, RELEASE_LIMIT, FOUR_EYES, READ_ONLY_ROLE)
- [x] 4. Resolution: vendor (tax number → bank+similar name → normalised name → unknown with candidates)
- [x] 5. Resolution: province, PO + suggestions, contract, department, requester (terminated → manager), line type, currency/FX
- [x] 6. Checks: UNREADABLE, FIELD_UNCERTAIN, ARITHMETIC_LINE/SUBTOTAL/TOTAL, DATE_ODD, DATE_AMBIGUOUS, TERMS_MISMATCH, FX_RATE_FALLBACK, SHIP_TO_UNKNOWN
- [x] 7. Checks: VENDOR_UNKNOWN, VENDOR_PENDING, VENDOR_ON_HOLD, VENDOR_NEW, VENDOR_LOOKALIKE, TAX_NUMBER_MISMATCH
- [x] 8. Checks: BANK_MISMATCH, BANK_CHANGE_UNVERIFIED, BANK_CHANGE_RECENT
- [x] 9. Checks: TAX_WRONG_FOR_PROVINCE, TAX_AMOUNT, TAX_NOT_REGISTERED, CURRENCY_UNEXPECTED
- [x] 10. Checks: PO_REQUIRED_MISSING, PO_NOT_FOUND, PO_VENDOR_MISMATCH, PO_CLOSED, PO_OVER_BALANCE
- [x] 11. Checks: CONTRACT_EXPIRED, CONTRACT_FEE_MISMATCH, CONTRACT_RATE_OVER_CAP, CONTRACT_FUEL_OVER_CAP, CONTRACT_MONTHLY_CAP, CONTRACT_PERIOD_REPEAT
- [x] 12. Checks: SPLIT_SUSPECTED, REQUESTER_TERMINATED, SELF_APPROVAL (history), CREDIT_NOTE_ORPHAN
- [x] 13. Duplicate detection: DUP_EXACT, DUP_NEAR, DUP_CONTENT, DUP_PAID_BY_CARD (lookalike vendors count as one)
- [x] 14. Checks runner (`runChecks`) + `scripts/history-replay.ts`: compare against "What is planted"; explain differences below
- [x] 15. Smart coding (same description at vendor → vendor default → nearest description) + `scripts/coding-accuracy.ts` (train Jan–Aug, test Sep–Oct; account and department)
- [x] 16. Approval routing: policy rows P01–P13, rules → steps → people (self, leave, terminated, repeats, unresolvable), release eligibility; the five worked examples as tests

## Stop condition

History replay matches "What is planted" (or each difference explained here), the five worked routing
examples pass, and both coding accuracy numbers are printed.

## Log

### Item 1: counts (2026-11-21)
`npx tsx scripts/verify-counts.ts`: 91 of 91 counts match BUILD_PLAN Tables (plus the routing facts:
U012 on leave → U003, U015 terminated, U003's 46 releases by U002 44 / U001 2, 51 unique tax numbers,
largest invoice $28,377.22, at most one contract per vendor). No mismatch.

### Item 2: refs and history adapter (2026-11-21)
`src/lib/rules/{keys,refs,history,offices,format}.ts`. `Refs.invoices` holds only the invoices known
before the one being checked (`refsAsOf` for the replay: received date, then id), so a duplicate pair
flags once, on the second arrival. History has no remittance on record, so bank checks cannot fire on it;
terms are rebuilt as `Net (due − invoice date)`. `ResolvedInvoice` has no id, so `refs.self` carries it
(logged in questions.md).

### Item 3: roles and permissions (2026-11-21)
`src/lib/auth/permissions.ts`: `MATRIX` (20 actions × 6 roles, scoped: own submissions, own department,
own department or step, own step, up to limit), `VENDOR_VIEW` for bank masking, `authorize`, and the six
invariants plus `canDecideStep` / `canRelease`. The matrix test checks all 120 cells against an independent
transcription of BUILD_PLAN's table. APPROVER_CANNOT_RELEASE also blocks the absent approver a delegate
approved for (the approval was on their authority).

### Item 4: vendor resolution (2026-11-21)
`src/lib/rules/resolve/vendor.ts`. A step matching more than one record is not a hit: V001/V051 and
V002/V053 share a bank account, and V001/V051, V002/V053, V026/V052 share a normalised name, so those
fall through and end as no vendor with both records offered (never chosen). Thresholds added to
`config.resolution` (bank-match name similarity 0.5, 3 candidates, min similarity 0.2). Every master
record resolves to itself by tax number; V054 (no tax number) by its unique name.

### Item 5: resolution of the other fields (2026-11-21)
`src/lib/rules/resolve/{fields,index}.ts`; `resolveInvoice(normalized, refs, {uploaderId, codeLine})`.
- Province: full office address, else a standalone province code, else the city; otherwise null.
- PO remaining = PO amount − subtotals of non-rejected invoices on it. PO-2026-0037 has $1,800.00 left, so
  it is not offered for a $2,150.00 subtotal; PO-2026-0046 is offered for V012.
- Department, left-one-out on history: **368 of 394** (vendor+province) and **375 of 425** (vendor alone),
  equal to BUILD_PLAN, with ties going to the department the vendor billed first. Ties to the most recent
  gave 360 and 381.
- Requester: PO's or uploader's, kept as is. A terminated requester raises REQUESTER_TERMINATED (item 12),
  and routing uses `effectiveRequester` (their manager).
- Line type: learned from history (5020 and 6630 are the only mixed accounts, found from the data, not
  hard-coded); the nearest description reproduces all 51 history lines on them, including the six "Tire service (units)" lines as services.
- FX reproduces `fx_rate_to_cad` on all 34 USD invoices; after the last row it uses the last row (fallback).
- Line accounts come from a `codeLine` hook; vendor default until smart coding (item 15).

### Item 6: reading, arithmetic and date checks (2026-11-21)
`src/lib/rules/checks/reading.ts` (+ shared test fixtures). None of UNREADABLE, FIELD_UNCERTAIN, ARITHMETIC_*,
SHIP_TO_UNKNOWN, FX_RATE_FALLBACK or TERMS_MISMATCH fires on any of the 426 history invoices (history
arithmetic is clean; terms equal the vendor's on all 426). DATE_ODD emits one flag per odd condition; only an
invoice date in the future holds. Required fields: vendor name, invoice number, invoice date, total.
Class/effect for the three codes BUILD_PLAN's table does not list: DATE_AMBIGUOUS data/hold,
FX_RATE_FALLBACK data/info, SHIP_TO_UNKNOWN data/hold (logged in questions.md).

### Item 7: vendor checks (2026-11-21)
`src/lib/rules/checks/vendor.ts`. `lookalikePairs` finds exactly V001/V051, V002/V053, V026/V052 from the data.
VENDOR_LOOKALIKE fires only on the record with fewer known invoices, and only when it has at most
`config.checks.lookalikeMaxHistory` = 3 (V052 0, V053 2, V051 3; V026 4, V001 12, V002 12). So V001's fuel
invoice and V002's credit note are not flagged; V052's is. VENDOR_NEW = no invoice in approved, scheduled,
released or paid state among the known invoices.
Replay note for item 14: history starts in January 2026 but vendors were onboarded 2019–2024, so a vendor's
first invoice in the replay is not really from a new vendor. VENDOR_NEW is a route flag (not a hold), and
the replay will count it separately rather than as a false positive.

### Item 8: bank checks (2026-11-21)
`src/lib/rules/checks/bank.ts`. BANK_CHANGE_UNVERIFIED over history fires on exactly AP-00426, as planted.
It skips an existing invoice that is rejected (AP-00052) or whose payment was scheduled before the change
(AP-00388: scheduled 2026-10-26, change 2026-10-27, settled 2026-10-29). Worth a look by a person:
AP-00388 settled two days after the unverified change. `refs.self` now carries the invoice's status. BANK_MISMATCH cannot fire on history (no
remittance recorded); it treats an account printed for a vendor with no bank on file as a mismatch.
BANK_CHANGE_RECENT counts any change, verified or not, within 30 days before the invoice date.

### Item 9: tax and currency checks (2026-11-21)
`src/lib/rules/checks/tax.ts`. Over history TAX_WRONG_FOR_PROVINCE fires on exactly AP-00098, AP-00253,
AP-00325 (the three planted); TAX_AMOUNT and CURRENCY_UNEXPECTED never fire. Exempt categories come from
`config.tax.exemptCategories` (["Insurance"]: every EXEMPT history line is from an Insurance vendor; every
FOREIGN line from a US vendor). In BC with a line of unknown type, PST is neither required nor rejected (no
guessing). A tax line with an unknown label skips TAX_WRONG_FOR_PROVINCE (reading problem, not a tax error).

### Item 10: PO checks (2026-11-21)
`src/lib/rules/checks/po.ts`. Over history, each invoice against the ones before it:
- PO_OVER_BALANCE fires on exactly AP-00159, AP-00216 (planted) and AP-00224 (PO-2026-0027) and AP-00407
  (PO-2026-0044), the second bills of the two POs billed twice by the duplicates. 4 = "2, plus two POs billed twice".
- PO_REQUIRED_MISSING fires on exactly AP-00200/00206/00207 (the split trio, "no PO though the vendor requires one").
- No PO_VENDOR_MISMATCH or PO_NOT_FOUND in history.
- PO_CLOSED: every closed PO in the CSV was closed by its own invoices (none closed without an invoice), so
  the replay (item 14) must treat a PO as open until its last history invoice is entered, or every PO invoice
  in history would show PO_CLOSED against the PO's final status.

### Item 11: contract checks (2026-11-21)
`src/lib/rules/checks/contract.ts`; patterns in `config.contracts`. Replay (each invoice vs the ones before it):
- CONTRACT_FEE_MISMATCH: 13, as planted.
- CONTRACT_MONTHLY_CAP: AP-00075 (C024 Feb, $15,727.70), AP-00155 (C027 Apr, $12,969.94), AP-00234 (C022 Jun,
  $24,937.05): exactly the planted three, using subtotals by invoice-date month (totals would give other
  numbers). The April C027 breach is caused by AP-00155, the reformatted-number duplicate of AP-00136.
- CONTRACT_PERIOD_REPEAT: 1, AP-00026 (info), the second GR26-2821 from V037 that the approver rejected as a duplicate.
- No CONTRACT_EXPIRED: V044's three invoices dated after C025 ended carry no contract id in history (billed on
  POs). A new V044 invoice resolves to C025 and does fire, as BUILD_PLAN expects for torqueindustrial_1771.
- No CONTRACT_RATE_OVER_CAP or CONTRACT_FUEL_OVER_CAP (none planted; history's surcharges reproduce from
  the LTL lines and max out at 12.00%).

### Item 12: split, terminated requester, self-approval, orphan credit note (2026-11-21)
`src/lib/rules/checks/people.ts`. Replay results:
- SPLIT_SUSPECTED: exactly AP-00129/AP-00131 ($14,236.36) and AP-00200/00206/00207 ($14,070.00), as planted,
  flagged on the invoice that crosses $10,000. Getting there took two rules beyond BUILD_PLAN's wording:
  1. **Same requester when both are known** (PLAN.md's "same vendor + requester"). With vendor alone, AP-00120
     (U039) joined the Deskhive pair, AP-00191 (U015, $357.92) joined the Torque trio, and AP-00303/00304
     (Northstar, U027 and U028) showed up as a split. Incoming documents name no requester, so unknown matches anyone.
  2. **Copies are not splits**: an earlier invoice with the same number key, or the same digits and total within
     $1, is a duplicate. Without this, AP-00155 (reformatted duplicate of AP-00136) appeared as a split.
- SELF_APPROVAL: exactly AP-00092, AP-00178, AP-00235 (U010). Class fraud, effect info (a past breach of the
  four-eyes rule to review; it cannot happen to a new invoice because the service refuses it).
- REQUESTER_TERMINATED: none in history (U015's last invoice was received 2026-09-05, before 2026-09-15).
- CREDIT_NOTE_ORPHAN: none in history (no credit notes).

### Item 13: duplicate detection (2026-11-21)
`src/lib/rules/checks/dupes.ts`. Replay (each invoice vs the ones before it), exactly as planted:
- DUP_EXACT 5: AP-00026~00007 and AP-00237~00219 (rejected by the approver), AP-00034~00023 and
  AP-00224~00215 (paid twice), AP-00407~00394 (both scheduled for 2026-11-02).
- DUP_NEAR 2: AP-00077~00073 (`604`/`000604`), AP-00155~00136 (`1655-A`/`FA-001655`).
- DUP_PAID_BY_CARD 6: CT-00017, CT-00026, CT-00318, CT-00383 (Paper Trail), CT-00324, CT-00551 (Alpenglow).
- DUP_CONTENT 0.
Two readings of BUILD_PLAN needed to reproduce it:
1. BUILD_PLAN defines numberKey without leading zeros, so `000604`/`604` share a numberKey, yet it lists them
   as DUP_NEAR. DUP_EXACT therefore also needs the same printed number (letters and digits, zeros kept);
   a numberKey match that differs only in leading zeros is DUP_NEAR. Both are fraud/hold, so only the label differs.
2. One card charge pays one invoice: CT-00324 matched both AP-00215 and its duplicate AP-00224, so a charge that
   already matches an earlier invoice is attributed to that one. AP-00224 still gets DUP_EXACT.
Trap test: for each of the 17 fixed-fee vendors, the next bill (same total, next number, 3 weeks later) raises
no duplicate. Lookalike records count as one vendor (V053 reusing a V002 number → DUP_EXACT).

### Item 14: checks runner and history replay (2026-11-21)
`src/lib/rules/checks/index.ts` (`runChecks`, 42 codes), `src/lib/rules/replay.ts`, `scripts/history-replay.ts`
(`npx tsx scripts/history-replay.ts`; sets APP_TODAY=2026-11-02 itself). **Result: the replay matches "What
is planted", 14 of 14 rows** (13 planted rows plus the three lookalike pairs), and there are **no hold-level flags
outside the planted table** (no false-positive holds on history).
Differences, each explained (all info or route, never hold):
- VENDOR_NEW ×53 (route): replay artifact. History starts in January but vendors were onboarded 2019–2024, so
  each vendor's first replayed invoice has no approved invoice before it. With all history known, exactly
  V052, V054, V055, V056 are new (tested).
- BANK_CHANGE_RECENT ×5 (info): invoices within 30 days after a callback-verified bank change (tested).
- CONTRACT_PERIOD_REPEAT ×1 (info): AP-00026, itself the planted duplicate.
- Reconciliation rows (cheques, bank fees, PADs) are the reconciliation bonus, not the checks engine.
Fixes made while replaying:
- VENDOR_LOOKALIKE now needs strictly fewer invoices than the lookalike. With "at most as many", every pair's
  first replayed invoice (0 vs 0) and V001's AP-00123 (2 vs 2) fired; now exactly V051 ×3 and V053 ×2.
- PO status as of each invoice: a closed PO counts as open until its last history invoice is entered.

### Item 15: smart coding (2026-11-21)
`src/lib/rules/coding.ts` (`suggestAccount` with a reason per line; `smartCoder` is now `resolveInvoice`'s
default line coder), `scripts/coding-accuracy.ts` (`npx tsx scripts/coding-accuracy.ts`).
Trained on the 348 invoices dated January–August, tested on the 78 dated September–October:
- **Account right on first suggestion: 147 of 147 lines (100.0%)**: 144 by vendor default, 3 by same description
  at the vendor (racking → 5030).
- **Department right on first suggestion: 143 of 147 lines (97.3%); 76 of 78 invoices (97.4%)**: PO's department,
  else vendor+province, else vendor, from the training months only.
Also confirmed: the vendor default alone is right on 799 of 809 history lines, and the 10 "Racking components"
lines are all 5030 (BUILD_PLAN). Description matching ignores numbers ("qty 120" = "qty 80").

### Item 16: approval routing (2026-11-21)
`src/lib/rules/routing/policy.ts` (P01–P13 mapped by hand from approval_policies.csv, original text kept,
P07/P08/P11 locked) and `src/lib/rules/routing/route.ts` (`route`, `releaseEligibility`, `routingInputFor`).
**The five worked examples pass** (`src/lib/rules/__tests__/routing.test.ts`):
1. D01 $4,743.80 → U007; release U003, U002 or U001.
2. D07 $18,758.00 → U003 for U012 (on leave, limit 10,000 kept); FM step U003 → U002 (repeat); release U001 only.
3. Legal $339.52, D08 → U001; U003 (P06); release U002 only.
4. Requested by U010, IT, $2,700 → U010 → U001 (P07); release U003 or U002.
5. D04 $60,000 → U002; U003; controller U002 → U001 (repeat); nobody may release, with the reason.
History check: P01–P13 alone put a finance manager step on 46 history invoices (43 over $10,000, 3 Legal);
adding "an overridden fraud flag adds the finance manager" for the 2 on-hold-vendor invoices gives exactly
the 48 invoices that have a finance manager step in approvals.csv.
P05 ("pending_review or new") is expressed as `flag in [VENDOR_PENDING, VENDOR_NEW]`, since BUILD_PLAN's rule
conditions are ANDed. A suspected split routes as the combined amount. A terminated requester is replaced by
their manager before P07 (U015's invoice in D01 → U007 is the requester → step goes to U001).

## Stop condition: met (2026-11-21)
- History replay matches "What is planted", 14 of 14 rows; every other flag explained above; no false-positive holds.
- The five worked routing examples pass.
- Coding accuracy printed: account 147 of 147 lines; department 143 of 147 lines (76 of 78 invoices).
Run: `npx tsx scripts/verify-counts.ts`, `npx tsx scripts/history-replay.ts`, `npx tsx scripts/coding-accuracy.ts`, `npm test`.
