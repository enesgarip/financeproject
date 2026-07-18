# Known Risks

## 1. Encoding / Mojibake (mitigated)

A repo-wide scan on 2026-06-05 found **no** UTF-8 mojibake in `src`, `docs`, the SQL migrations, or `README.md` — Turkish characters render correctly. The audit was repeated on 2026-06-15 with the encoding guard plus a manual signature scan across 305 source/doc/migration files; no mojibake signatures were found. Earlier reports were most likely a terminal display artifact rather than corrupted bytes.

A regression guard now runs in CI: `src/utils/encoding.guard.test.ts` (part of `npm run test:unit`) reads every source/doc/migration file via Vite's `?raw` glob and fails if the tell-tale mojibake digraphs (the garbled two-character forms Turkish letters degrade into) or the Unicode replacement character reappear. The guard file itself lists the exact signatures and is the only file excluded from the scan.

Residual risk is low: keep editors and tooling on UTF-8.

## 2. Domain Logic Concentration in Large Page Files (mitigated)

All four original large page files have been split into focused modules. The last
remaining monolith (`DataHealth.logic.ts`, 1413 lines) was split into a thin
orchestrator (~160 lines) and `DataHealth.checks.ts` (~900 lines of domain check
functions). No page file now exceeds ~460 lines.

Residual risk: `DataHealth.checks.ts` is still the largest single logic file, but
each check function is self-contained and independently testable.

## 3. Frontend Assumes Certain Migrations/RPCs Already Exist (mitigated)

The code still detects missing schema cache / missing function cases, but the
highest-risk paths now fail visibly instead of silently degrading:

- user-visible actions use `missingSupabaseCapabilityMessage`
- retired RPC signatures are not retried as hidden compatibility paths
- app-start/card-page maintenance surfaces missing maintenance RPC deployment
- ledger and live-reconciliation panels show migration-drift warnings when
  their tables are absent

Remaining allowed fallbacks are intentionally narrow: Analysis reports optional
missing tables through `SchemaMigrationNotice`, and backup/restore skips tables
that are not deployed in the target environment.

User backups include support tables added after the original backup feature:
card aliases, dismissals, and push subscriptions are restorable; user-owned
SMS/notification logs and both ledgers are audit exports only. Ledgers restart
with opening events after restore. Ownerless raw SMS diagnostics are
service-role-only, never user-readable.

## 4. Card Debt Math Has Multiple Derived Fields (mitigated)

Credit card debt depends on several related fields (`debt_amount`,
`statement_debt_amount`, `current_period_spending`, `provision_amount`,
scheduled installments). Three layers now prevent inconsistency:

1. **DB triggers**: `clamp_card_breakdown` BEFORE trigger enforces
   split ≤ debt on every write; `record_card_debt_event` AFTER trigger
   appends every change to the append-only `card_ledger`.
2. **DataHealth checks**: `checkCards` detects split inconsistency,
   scheduled-debt gaps, unclassified debt; `checkLedgerDrift` catches
   ledger projection ≠ stored debt.
3. **Unit tests**: `clampCardBreakdown`, `cardDebtBreakdown`,
   `buildCreditLimitGroups`, and DataHealth card-drift checks are all
   tested in `financeSummary.test.ts` and `DataHealth.logic.test.ts`.

## 5. Mixed Loan Model (mitigated)

The dashboard supports both explicit `loan_installments` and legacy
`loan.monthly_payment` fallback. This is intentional: loans without an
installment plan still need to appear in cash-flow projections.

The fallback is clearly labeled: `obligations.ts` tags legacy rows as
`kind: 'legacy_loan_installment'` with `isEstimate: true`, and
`financeSummary.ts` only uses `monthly_payment` for loans not covered by
`loan_installments`. DataHealth `checkLoans` flags loans that have no plan
and nudges the user to create one.

No duplicate counting risk remains: the `plannedLoanIds` set ensures a
loan is counted via exactly one path.

## 6. Data Health Page Is Operationally Powerful (mitigated)

`DataHealthPage` can apply bulk safe fixes, undo recent fix batches, and
reset all user finance data through RPC. Three safety layers exist:

1. **Undo batches**: every `fixIssue` call captures pre-mutation row
   snapshots in an `UndoBatch`; the user can roll back from the UI.
2. **Export backup**: JSON and CSV data export is available before any
   bulk operation; the "reset all data" flow takes an automatic JSON
   backup before calling the destructive RPC.
3. **Test suite**: `DataHealth.logic.test.ts` covers check logic for
   asset normalization, card debt breakdown, card/account ledger drift,
   and more — false-positive checks break CI before reaching production.

## 7. Limited Safety Net from Tests (mitigated)

A Vitest unit suite now covers the core pure finance utilities — statement period math (`cardStatement`), budget alerts (`budgetAlerts`), savings-goal progress (`savingsGoal`), live valuation (`valuation`), market-rate parsing (`marketRates`), category inference (`categories`), last-used memory (`lastUsed`), card installment calendar (`cardInstallmentCalendar`), statement reminders (`statementReminder`), and financial summary aggregations (`financeSummary`) — and runs in CI via `npm run test:unit`.

DataHealth check logic is tested in `DataHealth.logic.test.ts`. The remaining
uncovered areas are page components (UI-level side effects) and Supabase RPC
mutations (require a running database). These are covered by the Playwright
smoke suite and manual verification against the local Supabase docker.

## 8. Shared Credit Limit Semantics (mitigated)

Limit grouping uses `limit_group_name` and treats group limit as the
**maximum** card limit in the group, not the sum — this matches how Turkish
banks expose a shared limit across multiple cards. The rule is documented
with a code comment in `financeSummary.ts` (`buildCreditLimitGroups`) and
tested in `financeSummary.test.ts` with dedicated `describe` blocks covering
shared-limit grouping and multi-card scenarios. DataHealth `checkCards` also
detects over-limit groups at runtime.

## 9. Turkish Search Normalization (mitigated)

Filtering/matching text with `toLocaleLowerCase('tr-TR')` can miss all-caps bank or merchant names such as `MIGROS`, `BIM`, and `IS BANKASI` because plain ASCII `I` lowercases to dotless `ı`.

Use `src/utils/searchText.ts` for search/filter keys. The 2026-06-16 component audit moved shared CRUD search, quick actions, dashboard history search, Analysis export search, category inference, bank branding, and card bank-name normalization onto that helper.
