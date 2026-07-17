# Card Debt Transitions

Last reviewed: 2026-07-08

This file is the working source of truth for how credit-card debt moves through
the app. If an RPC, page action, or data-health fix changes one of these rules,
update this file in the same change.

## Canonical Fields

For `cards.card_type = 'kredi_karti'`:

- `debt_amount`: total card debt. This includes statement debt, posted current
  period spending, provisions, and future scheduled installment debt already
  created by the app.
- `statement_debt_amount`: billed/open-statement debt that is immediately due.
- `current_period_spending`: posted spending that has not been cut into a
  statement yet.
- `provision_amount`: provisional spending that uses limit but is not payable.
- `card_installments`: planning rows for installment timing. `due_month` is a
  legacy column name but now stores the exact installment due date, preserving
  the original transaction day when monthly installment rows are generated.
  These rows are inside card debt, not a second independent debt bucket.

The visible split must never exceed total debt:

```text
statement_debt_amount + current_period_spending + provision_amount <= debt_amount
```

The database trigger `clamp_card_breakdown()` enforces this on writes. Its
priority is statement first, then provision, then current period. The TypeScript
twin is `clampCardBreakdown()` in `src/utils/financeSummary.ts`.

## Display Helpers

Use `src/utils/financeSummary.ts` instead of reimplementing card math in pages:

- `cardProvisionAmount(card)`
- `cardSplitTotal(statementDebt, currentPeriod, provisionAmount)`
- `scheduledCardInstallmentTotalsByCard(installments)`
- `cardDebtBreakdown(card, scheduledTotal)`
- `cardPayableDebt(card)`
- `buildCreditLimitGroups(cards)`
- `clampCardBreakdown(debt, statement, current, provision)`

`buildCreditLimitGroups` is also the source for shared-limit semantics: group
limit is the max `credit_limit` in the group, while group debt is the sum of
member `debt_amount` values.

## Transition Matrix

| Action | Owner | Card field changes | Related rows |
| --- | --- | --- | --- |
| Posted expense added | `add_card_expense` | `debt_amount += amount`; `current_period_spending += installments whose due date has passed` | Inserts `card_expenses`; multi-installment expenses create exact-date installment rows, posting only rows due on/before today |
| Provision expense added | `add_card_expense` with `status='provision'` | `debt_amount += amount`; `provision_amount += amount` | Inserts a provision `card_expenses` row; no installment rows are created until posting |
| Provision posted | `post_card_provision` | `provision_amount -= posted amount`; `current_period_spending += installments whose due date has passed` | Full post updates the same expense; partial post leaves the original provision with the remaining amount and inserts a posted expense; multi-installment posted provisions create exact-date installment rows |
| Provision cancelled | `cancel_card_provision` | `debt_amount -= amount`; `provision_amount -= amount` | Marks the expense `cancelled`; removes related installment rows if any |
| Expense cancelled (any status) | `cancel_card_expense` | `debt_amount -= amount`; provision rows reduce `provision_amount`; posted rows reduce the visible bucket they affected (`current_period_spending` for unstatemented posted amounts, `statement_debt_amount` for statemented posted amounts). Future scheduled installment debt is removed from total debt without double-reducing current period. | Marks the expense `cancelled`; removes related installment rows; logs a correction to `transaction_history` |
| Scheduled installment due date reached | `post_due_card_installments` / finance maintenance | `current_period_spending += due scheduled installment total`; `debt_amount` unchanged | Changes due `card_installments` from `scheduled` to `posted`; maintenance runs this before statement cutting, and statement cutting keeps posted installment rows after the statement boundary in the new period |
| Statement cut | `cut_card_statement` / `cut_due_card_statements` | `statement_debt_amount += statement-period current spending`; `current_period_spending` keeps only already-posted rows after the statement boundary; `debt_amount` unchanged | Inserts or returns an open `card_statement_archives` row; links posted expenses/installments whose dates are on or before the statement boundary |
| Statement paid | `pay_card_statement` | Source bank account `current_balance -= statement amount`; card `debt_amount -= statement amount`; card `statement_debt_amount -= statement amount` | Marks the statement `paid`; marks linked card installments `paid` |
| Manual card debt paid | `pay_card_debt` | Source bank account `current_balance -= amount`; card `debt_amount -= amount`; statement debt is reduced first, then current-period spending | Does not close statement archive rows; does not change provisions or future scheduled installments |
| Planned payment paid from credit card | `pay_payment` with a credit-card source | Source credit card `debt_amount += paid amount`; `current_period_spending += paid amount` | Inserts a posted `card_expenses` row for the planned payment; advances or closes the payment row |
| Planned payment reconciled from card import | `pay_payment_from_card_import` | Source credit card `debt_amount += paid amount`; `current_period_spending += paid amount` | Inserts a posted `card_expenses` row using the bank movement/statement date; advances or closes the matched payment row |
| Statement import credit/refund row | `StatementImportModal` + `post_card_debt_correction` | Card `debt_amount -= amount`; negative correction reduces current-period spending first, then statement debt, then provision | DenizBank statement rows ending with `+ TL` are imported as auditable reverse entries instead of positive spending, so bank statement totals stay net of refunds/credits |
| Posted expense edited | `update_card_expense` | Reverses the previous posted impact, then applies the new posted impact | Recreates installment rows for the edited expense |
| Old installment plan carried over | `record_card_installment_carryover` | `debt_amount += remaining installment total`; `current_period_spending += remaining installments whose exact due date has passed` | Called by the unified installment form when "paid installments so far" is positive; inserts one posted expense, paid historical installment rows, and remaining exact-date installment rows |
| Card debt recomputed from ledger | `recompute_card_debt_from_ledger` | `debt_amount = sum(card_ledger.amount_kurus) / 100`; if the projection lowers total debt, visible split is reduced from current period first, then statement, then provision | Suppresses the ledger trigger for this repair write so no duplicate event is emitted |
| Card debt manual correction | `post_card_debt_correction` | `debt_amount += signed correction`; positive corrections add to current-period spending, negative reverse entries reduce current period first, then statement, then provision | Writes an auditable `card_ledger.kind='adjustment'` event with the required reason note |
| Card import reset | `reset_card_import_data` | Sets `debt_amount`, `statement_debt_amount`, `current_period_spending`, and `provision_amount` to `0` before a clean import rebuilds the open/current scope | Deletes unarchived/open/current-period card expenses, installments, current/open statement archives, and their history; preserves paid historical statement archives and rows linked to them |
| Card data reset | `reset_card_data` | Sets `debt_amount`, `statement_debt_amount`, `current_period_spending`, and `provision_amount` to `0` | Deletes dependent card expenses, installments, statement archives, and related history for that card. Statement/current movement import modals must not call this flow. |

## Statement Boundary

Statements are cut the day after the statement day, not on the statement day.
This lets spending made on the statement day itself belong to that statement.

The server-side daily maintenance job calls the same audited RPCs used by the
client:

- `cut_due_card_statements`
- `post_due_card_installments`
- `post_card_provision`

Do not duplicate their money-moving logic in a scheduler or page component.

## Payment Semantics

`cardPayableDebt(card)` is:

```text
max(0, statement_debt_amount + current_period_spending)
```

Payable debt excludes provisions and future scheduled installment debt. A
provision must be posted before it becomes payable. Future installments first
become current-period debt when their own due date passes, then become payable
through the normal statement cut; they are not added again to dashboard debt.

The preferred user flow is paying an open statement with `pay_card_statement`.
`pay_card_debt` is the manual payment path for posted debt that is not
represented by an open statement — including current-period spending before the
statement is cut. The cards page exposes it as a "Borç öde" button on each
credit-card row (shared payment drawer, editable amount defaulting to
`cardPayableDebt`, bank-account source). The button is disabled while the card
has an open statement archive, because `pay_card_debt` lowers
`statement_debt_amount` without closing the archive row (data health would flag
the mismatch) — the same reason the obligations calendar only emits its
`pay_card_debt` item for cards without an open statement.

Cash-flow/obligation projections must not reuse a paid statement's old due date
for new current-period spending. When no statement is pending, the current-period
cash due date comes from the card's active statement period; after the statement
day has passed, a paid statement due date (for example July 14) belongs to the
old statement, while new current-period spending moves to the next cycle (for
example August 14). When a statement is still pending, current-period spending
remains one cycle after that pending statement so both loads never collide.

When `pay_payment` is funded by a credit card instead of a bank account, it is
card spending, not cash outflow: the selected credit card receives a posted
expense and its `debt_amount` / `current_period_spending` increase by the paid
amount.

DenizBank statement/current movement imports use `pay_payment_from_card_import`
for rows that match a still-open planned payment. It is the same credit-card
spending semantics as `pay_payment`, but the generated `card_expenses.spent_at`
uses the bank row date and the note keeps the planned-payment due date. This
prevents a bill from staying pending after its card movement is imported.

## Ledger Authority

`card_ledger` is the append-only audit trail for `cards.debt_amount`. Ordinary
RPCs continue to update `cards.debt_amount`; the trigger records each delta as
integer kuruş. Repair flows follow the same append-only rule:

- `recompute_card_debt_from_ledger` pulls `debt_amount` back to the exact ledger
  projection and suppresses the trigger for that repair write.
- `post_card_debt_correction` is the preferred manual fix. It changes
  `debt_amount` through a signed adjustment and records the reason in
  `card_ledger`.

Do not patch `debt_amount` directly from page code or data-health logic. Use the
ledger correction RPCs or fix the upstream transition that created the drift.

## Data-Health Expectations

Data health may flag:

- split total greater than `debt_amount`
- unexplained card debt where `debt_amount` is greater than visible split plus
  scheduled installments
- cards over shared/individual limit
- statement/archive mismatches
- overdue open statement archives that likely need a `pay_card_statement` flow
- Card-list due-date and overdue badges use the earliest unpaid open archive's
  `due_date`. `nextMonthlyDate(due_day)` is only a fallback when no payable open
  archive exists; it cannot be used to detect an already overdue statement.
- ledger drift between `card_ledger` projection and `cards.debt_amount`

When fixing one of these, keep the field transition above intact and prefer a
single RPC/helper change over page-local compensation.
