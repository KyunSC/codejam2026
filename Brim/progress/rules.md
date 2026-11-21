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
- [ ] 8. Checks: BANK_MISMATCH, BANK_CHANGE_UNVERIFIED, BANK_CHANGE_RECENT
- [ ] 9. Checks: TAX_WRONG_FOR_PROVINCE, TAX_AMOUNT, TAX_NOT_REGISTERED, CURRENCY_UNEXPECTED
- [ ] 10. Checks: PO_REQUIRED_MISSING, PO_NOT_FOUND, PO_VENDOR_MISMATCH, PO_CLOSED, PO_OVER_BALANCE
- [ ] 11. Checks: CONTRACT_EXPIRED, CONTRACT_FEE_MISMATCH, CONTRACT_RATE_OVER_CAP, CONTRACT_FUEL_OVER_CAP, CONTRACT_MONTHLY_CAP, CONTRACT_PERIOD_REPEAT
- [ ] 12. Checks: SPLIT_SUSPECTED, REQUESTER_TERMINATED, SELF_APPROVAL (history), CREDIT_NOTE_ORPHAN
- [ ] 13. Duplicate detection: DUP_EXACT, DUP_NEAR, DUP_CONTENT, DUP_PAID_BY_CARD (lookalike vendors count as one)
- [ ] 14. Checks runner (`runChecks`) + `scripts/history-replay.ts`: compare against "What is planted"; explain differences below
- [ ] 15. Smart coding (same description at vendor → vendor default → nearest description) + `scripts/coding-accuracy.ts` (train Jan–Aug, test Sep–Oct; account and department)
- [ ] 16. Approval routing: policy rows P01–P13, rules → steps → people (self, leave, terminated, repeats, unresolvable), release eligibility; the five worked examples as tests

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
