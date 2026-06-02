# Finance Rules

## Scope

This file records the current business rules inferred from the codebase as of 2026-06-01. If code and this file diverge, update both intentionally.

## Money and Formatting

- Most monetary values are handled as decimal numbers and displayed in Turkish locale.
- Comparisons often use 2-digit rounding tolerance; values within roughly `0.01` may be treated as equal.

## Assets

- Cash assets use category `Nakit`.
- Asset estimated worth is normalized into TRY with `estimated_value_try`.
- Non-TRY assets may still be represented through an estimated TRY value for summaries.

## Cards: Core Model

Credit card debt is conceptually split into:

- `statement_debt_amount`: already billed, payable amount
- `current_period_spending`: posted spending in the current period but not yet statemented
- `provision_amount`: pending/provisional spending

Current code expects:

`debt_amount = statement_debt_amount + current_period_spending + provision_amount`

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

## Card Payment Rules

On the cards page:

- payable card debt excludes provision:
  - `payableDebt = max(0, debt_amount - provision_amount)`
- user should not pay more than payable posted debt
- provision must post before it becomes payable debt

## Card Expense Rules

- card expenses can be `provision`, `posted`, or `cancelled`
- cancelled expenses should not count toward budget alerts
- installment expense creation may generate `card_installments`
- single-installment data is treated differently from multi-installment planning and is checked in data health

## Card Installment Rules

From `src/utils/cardInstallmentCalendar.ts` and page logic:

- scheduled installments are summarized by `due_month`
- installment calendar defaults to upcoming months from the current month
- only `scheduled` installments count in scheduled-total style calculations
- `posted` installments represent already-posted/consumed rows
- paid card installments can be reversed:
  - scheduled rows return to `scheduled` and re-add to card `debt_amount`
  - posted rows return to `posted` and re-add to `debt_amount` plus the current statement/current-period bucket

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

## Loans

- loans may be tracked with explicit `loan_installments`
- if explicit installment rows do not exist, dashboard logic falls back to legacy monthly summary fields on the loan row
- paid loan installments can be reversed to `bekliyor`; loan remaining totals are recalculated, but source-account balance is not automatically refunded because the paid installment row does not store the source account id
- a loan should align with:
  - `remaining_amount`
  - `remaining_installments`
  - `status`
  - installment row state when installment rows exist

## Debts / Receivables

- `borç_aldım` behaves like money owed by the user
- `borç_verdim` behaves like receivable income
- debts may be TRY, FX, gram gold, or quarter gold in type
- summaries often use `estimated_value_try`

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

- monthly cash projection
- upcoming obligations within a lookahead window
- credit usage monitoring
- next-month load breakdown
- salary trend comparison
- history grouping and filtering

This means any change in card, loan, debt, or payment semantics likely affects dashboard math.
