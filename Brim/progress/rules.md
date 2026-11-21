# Loop B progress: rules engine

Branch `loop/rules`. Spec: BUILD_PLAN.md (Roles and permissions, Resolution, Checks, Duplicate detection,
Smart coding, Approval routing). One item per loop run: implement, test, commit, tick.

Code lives in `src/lib/rules/` (resolution, checks, duplicates, coding, routing) and `src/lib/auth/permissions.ts`.
Scripts in `scripts/` set `APP_TODAY=2026-11-02` themselves.

## Items

- [x] 1. `scripts/verify-counts.ts`: verify every count in BUILD_PLAN "Tables"; log mismatches below
- [x] 2. Refs (reference data indexes) + history adapter (InvoiceRow + lines → ResolvedInvoice) + name/number key helpers
- [ ] 3. Roles and permissions: matrix in `src/lib/auth/permissions.ts` + invariant checks (SELF_APPROVAL, NOT_YOUR_STEP, APPROVER_CANNOT_RELEASE, RELEASE_LIMIT, FOUR_EYES, READ_ONLY_ROLE)
- [ ] 4. Resolution: vendor (tax number → bank+similar name → normalised name → unknown with candidates)
- [ ] 5. Resolution: province, PO + suggestions, contract, department, requester (terminated → manager), line type, currency/FX
- [ ] 6. Checks: UNREADABLE, FIELD_UNCERTAIN, ARITHMETIC_LINE/SUBTOTAL/TOTAL, DATE_ODD, DATE_AMBIGUOUS, TERMS_MISMATCH, FX_RATE_FALLBACK, SHIP_TO_UNKNOWN
- [ ] 7. Checks: VENDOR_UNKNOWN, VENDOR_PENDING, VENDOR_ON_HOLD, VENDOR_NEW, VENDOR_LOOKALIKE, TAX_NUMBER_MISMATCH
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
