# Finance Rules

## Scope

This file records the current business rules inferred from the codebase as of 2026-06-15. If code and this file diverge, update both intentionally.

## Money and Formatting

- Most monetary values are handled as decimal numbers and displayed in Turkish locale.
- Comparisons often use 2-digit rounding tolerance; values within roughly `0.01` may be treated as equal.

## Assets

- Cash assets use category `Nakit`.
- Asset estimated worth is normalized into TRY with `estimated_value_try`.
- Non-TRY assets may still be represented through an estimated TRY value for summaries.

## Market Rates & Auto-Valuation

Gold and foreign-currency holdings, debts, and savings goals can derive their
TRY value from live market rates instead of a hand-typed `estimated_value_try`.

- Rate source: public truncgil v4 feed (`USD`, `EUR`, `GBP`, `GRA` = gram gold,
  `CEYREKALTIN` = quarter gold), fetched client-side on app open and via a manual
  "Yenile" button. The feed sometimes truncates its long JSON tail, so the parser
  (`src/utils/marketRates.ts`) falls back to tolerant per-symbol extraction.
- The `auto_valued` flag (on `assets`, `debts`, `savings_goals`) records opt-in.
  Only auto-valued rows are recomputed; existing manual rows are never overwritten.
- Quantity is the source of truth: gold uses `amount` (gram/piece), FX uses the
  foreign `amount`. `estimated_value_try` is a cached projection refreshed on each
  rate load (`syncAutoValuedRows`) so dashboard, summaries, and settlement RPCs
  keep reading an up-to-date stored value.
- Valuation side: holdings and receivables use the buying price (Alış); obligations
  you owe (`borç_aldım`, gold/FX debts) use the selling price (Satış).
- Symbol mapping: asset gold `unit='gram' → GRA`, `unit='adet' → CEYREKALTIN`;
  cash/`doviz` use the currency code; debt `gram_altin → GRA`,
  `ceyrek_altin → CEYREKALTIN`.
- If a rate is missing or the feed is offline, the stored `estimated_value_try`
  is used as a fallback.

## Cards: Core Model

Detailed field transitions are documented in `docs/CARD_DEBT_TRANSITIONS.md`.
Treat that file as the card-debt mutation source of truth when changing card
RPCs, page actions, dashboard math, or data-health checks.

Credit card debt is conceptually split into visible payable/planning parts:

- `statement_debt_amount`: already billed, payable amount
- `current_period_spending`: posted spending in the current period but not yet statemented
- `provision_amount`: pending/provisional spending
- scheduled future installment amount: future credit-card installment planning

Current code expects:

`debt_amount >= statement_debt_amount + current_period_spending + provision_amount`

When there are scheduled future card installments, the expected difference is the future installment amount. The future installment rows are planning rows inside card debt; they must not be added as a second independent debt bucket.

This relationship appears in both card page logic and dashboard/data-health checks.

## Shared Credit Limits

- Cards may share a limit through `limit_group_name`.
- Group limit is treated as the max `credit_limit` among cards in the same group, not the sum.
- Group debt is the sum of grouped cards' `debt_amount`.

## Card Statement Rules

From `src/utils/cardStatement.ts`:

- statement logic applies only to `kredi_karti`
- `statement_day` and `due_day` are required for statement-derived calculations
- statement date is the next statement day on or after transaction date
- period start is the day after the previous statement date
- period end is the statement date
- due date may fall in the same month or next month depending on `due_day <= statement_day`

Statement archive behavior:

- `card_statement_archives` tracks a monthly card statement with `period_year`, `period_month`, and `status`
- one user/card/month can have only one statement archive
- statement status is `open` until paid, then `paid`
- `cut_card_statement` is idempotent for one user/card/month
- statement amount is the posted current-period spending at cut time
- cutting a statement links posted card expenses and posted card installments through `statement_archive_id`
- statements are cut automatically the day **after** the statement day (like banks), so the statement day's own spending is included; the dashboard/cards page calls `cut_due_card_statements` on load and the daily `pg_cron` job runs it server-side. There is no manual "cut statement" action.
- statement/current movement imports match existing app expenses primarily by amount and same-or-near date, not by identical merchant text. The amount tolerance is 1 TL and the loose date window is 3 days. This lets the user keep personal descriptions while avoiding duplicate imports when bank posting dates drift by a few days.

## Scheduled Card Maintenance (server-side)

A daily `pg_cron` job runs `run_scheduled_card_maintenance()` so time-based card
transitions happen on the correct day even if the app is never opened.

- It impersonates each credit-card user (sets the JWT `sub` claim) and calls the
  existing, audited RPCs — `cut_due_card_statements` and `post_card_provision` —
  so there is no duplicated money logic.
- Statement cutting is idempotent (one archive per user/card/month); the client
  still calls `cut_due_card_statements` on app open as an immediate fallback.
- Provisions still pending after a threshold (default 7 days) are treated as
  cleared and posted into the current period. This is the one transition that
  mutates state on an assumption; it is logged to `transaction_history`.
- The function is intentionally **not** granted to `authenticated` (it would let
  one user trigger maintenance for everyone); only the scheduler runs it.

## Card Payment Rules

On the cards page:

- payable card debt excludes provision and future scheduled installments:
  - `payableDebt = max(0, statement_debt_amount + current_period_spending)`
- user should not pay more than payable posted debt
- provision must post before it becomes payable debt
- card debt payments must debit a `banka_karti` source account
- the preferred credit-card payment flow is paying an open statement with `pay_card_statement`
- statement payment debits a `banka_karti`, reduces card debt, marks the statement paid, and marks linked installments paid
- direct card debt payment is legacy/manual behavior and should not be the primary installment flow

## Card Expense Rules

- card expenses can be `provision`, `posted`, or `cancelled`
- cancelled expenses should not count toward budget alerts
- installment expense creation may generate `card_installments`
- single-installment data is treated differently from multi-installment planning and is checked in data health

Current movement reconciliation:

- DenizBank internet-banking movement PDFs are an intra-period reconciliation source, not a statement cut.
- `Bekleyen İşlem` rows import as `provision`; `Dönem İçi` spending rows import as `posted`.
- `Hesaptan Ödeme` rows are not imported as card expenses.
- `Taksitli Satış` rows are shown for manual review; the first implementation does not infer or recreate installment plans from current movement exports.
- Review screens show the app's spending history for the detected period, keep matched bank/app record pairs collapsed by default, and leave missing rows unselected until the user chooses which rows to import.
- Imports use the existing `add_card_expense` RPC so card debt, provision/current-period fields, ledger events, and transaction history stay under the audited mutation path.

## Card Installment Rules

From `src/utils/cardInstallmentCalendar.ts` and page logic:

- scheduled installments are summarized by `due_month`
- installment calendar defaults to upcoming months from the current month
- only `scheduled` installments count in scheduled-total style calculations
- `posted` installments represent already-posted/consumed rows
- credit-card installments are not separate debt
- the unpaid installment total is informational/planning data and must not be added on top of card debt
- posted installments become payable as part of the card statement
- paying the linked statement marks included installments `paid`
- credit-card installments are not manually paid; manual payment is limited to the card's statement/current-period debt
- locked installments, meaning paid or linked to a statement, should not be edited from the UI

## Bank Account / Transfer Rules

- `cards.card_type = 'banka_karti'` represents a bank account balance in the app.
- Manual account inflow/outflow updates one account balance and writes `transaction_history`.
- Bank-to-bank transfer uses `transfer_between_accounts`:
  - source and target must both be `banka_karti`
  - source and target cannot be the same account
  - source balance must be enough for the transfer amount
  - source balance decreases, target balance increases, and one `transfer` history row is written

## Transaction History Rules

Detailed history side effects are documented in `docs/TRANSACTION_HISTORY.md`.
Treat `transaction_history` as the user-facing activity feed, not the accounting
source of truth. Balance/card-debt invariants come from ledger tables, card
fields, statement archives, and trigger/RPC rules. New finance mutations should
write history in the same database transaction as the state change, with the
public RPC owning the feed row.

## Budget Alert Rules

From `src/utils/budgetAlerts.ts`:

- budget alerts are month-based
- alerts compare monthly budget rows to active card expenses in the same month
- cancelled card expenses are ignored
- status rules:
  - `over` if spent exceeds limit by more than `0.01`
  - `warning` if usage is at least `80%`
  - `ok` otherwise
- UI-relevant alert list currently filters out `ok`

## Payments

- payments can be one-off or monthly recurring
- recurrence types currently include `none` and `monthly`
- payment status is mainly `bekliyor` or `ödendi`
- marking a payment paid can use a bank card or credit card:
  - bank cards decrease `current_balance`
  - credit cards create a posted `card_expenses` row and increase `debt_amount` plus `current_period_spending`
- dashboard monthly load includes:
  - one-off payments due in the month
  - recurring monthly payments whose occurrence lands in the month

## Salary

- `salary_history` records the monthly net salary amount that becomes effective
  on `effective_date`; it is not a one-off deposit history.
- Monthly cash-flow summaries count one salary income for the target month using
  the salary record effective by that month's end.
- Forward cash projections repeat the salary each month until a newer effective
  salary record applies. A future salary record does not affect earlier months.
- The daily cash calendar shows upcoming obligations and cash impact; it does
  not create a daily salary deposit event from `salary_history`.

## Loans

- loans may be tracked with explicit `loan_installments`
- if explicit installment rows do not exist, dashboard logic falls back to legacy monthly summary fields on the loan row
- normal app flow should pay a loan installment through a selected `banka_karti` source account; it should not be marked paid as a visual-only action
- a loan should align with:
  - `remaining_amount`
  - `remaining_installments`
  - `status`
  - installment row state when installment rows exist

## Loan Affordability

`src/utils/loanAffordability.ts` is a decision-support calculator, not a bank
approval engine. It answers: "With the current app data, would a new consumer
loan installment strain monthly cash flow?"

- Stable income is the current effective salary from `salary_history`; one-off
  receivables are not treated as stable credit capacity.
- Existing load is conservative: the higher of near-term peak outflow and the
  forward forecast's average monthly outflow is used.
- Safe installment capacity is capped by a target income/load ratio and by
  available monthly surplus; weak cash buffers reduce the safe installment.
- Maximum principal is derived from the safe installment, user-entered monthly
  interest rate, and term using the standard amortized-loan formula.
- The balanced recommendation scans standard terms at the current monthly
  interest rate and uses roughly 85% of the safe installment capacity, so it is
  a comfort scenario rather than the absolute maximum the calculator can derive.
- The selected loan scenario is stressed against the forward cash projection;
  if the projection can go negative, the recommendation becomes "zorlayıcı."
- The first installment is assumed to start next month. Fees, insurance, bank
  campaign terms, and credit-score approval are outside the app model.

## Debts / Receivables

- `borç_aldım` behaves like money owed by the user
- `borç_verdim` behaves like receivable income
- debts may be TRY, FX, gram gold, or quarter gold in type
- summaries often use `estimated_value_try`
- open receivables are shown as expected collection and are not added to net worth until collected

## Savings Goals

Savings goals support:

- `TRY`
- `gram_altin`
- `ceyrek_altin`
- `composite`

Composite goal progress rule:

- progress is the average completion percentage of goal components
- if there are no components, progress is `0`

Non-composite goal progress rule:

- progress is `min(100, current_amount / target_amount * 100)` when target is positive

## Dashboard Planning Rules

Current dashboard behavior includes:

- net worth equals assets minus card, loan, personal debt, and pending payment liabilities
- open receivables are shown separately as expected collection
- monthly cash projection
- upcoming obligations within a lookahead window
- credit usage monitoring
- next-month load breakdown
- salary trend comparison
- history grouping and filtering

This means any change in card, loan, debt, or payment semantics likely affects dashboard math.
