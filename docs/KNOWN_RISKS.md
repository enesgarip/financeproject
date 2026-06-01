# Known Risks

## 1. Encoding / Mojibake

Some repo files currently show broken Turkish characters in terminal output and source text. This is a real maintenance risk because:

- UI text can regress silently
- docs and code reviews become harder
- search results may miss expected words

Affected examples were visible in `README.md` and several TSX/TS files during inspection.

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

## 7. Limited Safety Net from Tests

During this task, no dedicated automated finance test suite was visible in the repo layout.

Risk:

- regression detection depends heavily on manual review
- subtle money/date bugs can ship easily

## 8. Shared Credit Limit Semantics Are Non-Trivial

Limit grouping uses `limit_group_name` and treats group limit as the maximum card limit in the group, not the sum.

Risk:

- future contributors may incorrectly aggregate limits
- dashboard and card page calculations can diverge if this rule is forgotten
