# Known Risks

## 1. Encoding / Mojibake (mitigated)

A repo-wide scan on 2026-06-05 found **no** UTF-8 mojibake in `src`, `docs`, the SQL migrations, or `README.md` — Turkish characters render correctly. Earlier reports were most likely a terminal display artifact rather than corrupted bytes.

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

## 3. Frontend Assumes Certain Migrations/RPCs Already Exist

The code contains explicit fallback handling for missing schema cache / missing function cases. That usually means frontend and live database can drift.

Risk:

- some actions work in one environment and fail in another
- finance flows may partially degrade instead of failing clearly

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
