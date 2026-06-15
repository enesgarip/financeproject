# Known Risks

## 1. Encoding / Mojibake (mitigated)

A repo-wide scan on 2026-06-05 found **no** UTF-8 mojibake in `src`, `docs`, the SQL migrations, or `README.md` — Turkish characters render correctly. The audit was repeated on 2026-06-15 with the encoding guard plus a manual signature scan across 305 source/doc/migration files; no mojibake signatures were found. Earlier reports were most likely a terminal display artifact rather than corrupted bytes.

A regression guard now runs in CI: `src/utils/encoding.guard.test.ts` (part of `npm run test:unit`) reads every source/doc/migration file via Vite's `?raw` glob and fails if the tell-tale mojibake digraphs (the garbled two-character forms Turkish letters degrade into) or the Unicode replacement character reappear. The guard file itself lists the exact signatures and is the only file excluded from the scan.

Residual risk is low: keep editors and tooling on UTF-8.

## 2. Domain Logic Concentration in Large Page Files

Important finance behavior lives inside very large page components, especially:

- `src/pages/DashboardPage.tsx`
- `src/pages/CardsPage.tsx`
- `src/pages/DataHealthPage.tsx`

Risk:

- UI edits can accidentally change business logic
- reasoning about side effects is expensive
- testability is lower than it should be

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

## 4. Card Debt Math Has Multiple Derived Fields

Credit card debt depends on several related fields:

- `debt_amount`
- `statement_debt_amount`
- `current_period_spending`
- `provision_amount`
- scheduled installments

Risk:

- a partial update can create inconsistent totals
- dashboard, cards page, and data health can disagree

## 5. Mixed Loan Model

The dashboard supports both:

- explicit `loan_installments`
- legacy loan-row monthly logic

Risk:

- duplicate or inconsistent monthly obligation totals
- harder migration path toward a single model

## 6. Data Health Page Is Operationally Powerful

`DataHealthPage` can:

- apply bulk safe fixes
- undo recent fix batches
- reset all user finance data through RPC

Risk:

- a wrong rule or false-positive check can modify real user data
- changes here need extra caution and verification

## 7. Limited Safety Net from Tests (improving)

A Vitest unit suite now covers the core pure finance utilities — statement period math (`cardStatement`), budget alerts (`budgetAlerts`), savings-goal progress (`savingsGoal`), live valuation (`valuation`), market-rate parsing (`marketRates`), category inference (`categories`), and last-used memory (`lastUsed`) — and runs in CI via `npm run test:unit`.

Still uncovered, so manual review remains important for:

- large page components and their side effects
- Supabase RPC finance mutations
- aggregation utils (`cardInstallmentCalendar`, `financeSummary`, `statementReminder`)
- subtle money/date bugs outside the tested utilities

## 8. Shared Credit Limit Semantics Are Non-Trivial

Limit grouping uses `limit_group_name` and treats group limit as the maximum card limit in the group, not the sum.

Risk:

- future contributors may incorrectly aggregate limits
- dashboard and card page calculations can diverge if this rule is forgotten

## 9. Turkish Search Normalization (mitigated)

Filtering/matching text with `toLocaleLowerCase('tr-TR')` can miss all-caps bank or merchant names such as `MIGROS`, `BIM`, and `IS BANKASI` because plain ASCII `I` lowercases to dotless `ı`.

Use `src/utils/searchText.ts` for search/filter keys. The 2026-06-16 component audit moved shared CRUD search, quick actions, dashboard history search, Analysis export search, category inference, bank branding, and card bank-name normalization onto that helper.
