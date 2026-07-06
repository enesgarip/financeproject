# Supabase RPC Action Reference

Last reviewed: 2026-07-02

This file maps Supabase RPCs to the user-visible actions that call them. Keep it
updated whenever a page action, repository wrapper, or migration changes an RPC
contract.

For `transaction_history` side effects, type/source conventions, and no-history
repair rules, keep `docs/TRANSACTION_HISTORY.md` aligned with this file.

## Daily Maintenance

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `post_due_card_auto_payments` | `runFinanceMaintenance` in `financeSnapshotRepo` | App open/dashboard snapshot maintenance | Posts due `bank_auto` payments to their selected credit cards by reusing `pay_payment`; returns processed count |
| `cut_due_card_statements` | `runFinanceMaintenance`, `cutDueCardStatements` | App open/cards page maintenance | Cuts any due credit-card statements for the signed-in user; returns cut count |

## Cards And Statements

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `add_card_expense` | `addCardExpense` in `cardsRepo` | Cards page: add card expense/provision/installment expense | Inserts `card_expenses`; updates credit-card `debt_amount`, `current_period_spending`, and/or `provision_amount`; bank-card spending debits `current_balance` |
| `update_card_expense` | `updateCardExpense` in `cardsRepo` | Cards page: edit a posted expense | Reverses previous posted impact, writes new expense values, recreates installment rows |
| `post_card_provision` | `applyCardProvision` in `cardsRepo` | Cards page: post a provision | Moves all or part of a provision into posted current-period spending |
| `cancel_card_provision` | `applyCardProvision` in `cardsRepo` | Cards page: cancel a provision | Removes provision from card debt/limit impact and marks the expense `cancelled` |
| `cancel_card_expense` | `cancelCardExpense` in `cardsRepo` | Reconciliation: cancel any expense | Cancels a posted or provision expense, reverses total debt plus the exact visible split bucket, removes installments, logs correction |
| `cut_card_statement` | `cutCardStatement` in `cardsRepo` | Low-frequency/manual statement cut helper | Creates or returns the period archive and moves current-period spending into open statement debt |
| `set_statement_reconciliation` | `setStatementReconciliation` in `cardsRepo` | Statement import/reconciliation | Stores bank statement reconciliation amount and note for a card period |
| `pay_payment_from_card_import` | `payPaymentFromCardImport` in `cardsRepo` | Statement/current movement import: matched planned payment row | Adds the matched bill as posted credit-card spending on the bank row date and advances/closes the planned payment |
| `record_card_installment_carryover` | `recordCardInstallmentCarryover` in `cardsRepo` | Cards page: unified installment form when paid installments so far is positive | Imports remaining pre-app installments as card debt plus installment planning rows, while preserving already-paid historical installments |
| `reset_card_import_data` | `resetCardImportData` in `cardsRepo` | Statement/current movement clean import | Clears the open/current import scope and resets visible card debt fields before rebuilding from the bank PDF; preserves paid historical statement archives and linked old rows |
| `reset_card_data` | `resetCardData` in `cardsRepo` | Manual/data-health repair helper only | Deletes the card's expenses, installments, statement archives, and related history; resets card debt fields to zero. Import modals must not call it. |

The detailed field transitions for these RPCs live in
`docs/CARD_DEBT_TRANSITIONS.md`.

Statement import also uses `post_card_debt_correction` for DenizBank `+ TL`
credit/refund rows so the net statement total matches the bank archive without
rewriting historical expenses.

## Payments And Obligations

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `pay_payment` | `submitFinanceObligationPayment` | Planned payments page/dashboard obligation modal | Marks one payment paid or advances monthly recurrence; bank source debits `current_balance`, credit-card source increases `debt_amount` / `current_period_spending` and creates posted card spending |
| `pay_card_statement` | `submitFinanceObligationPayment` | Pay open credit-card statement | Debits a bank account, reduces card debt and statement debt, marks statement paid, marks linked installments paid |
| `pay_card_debt` | `submitFinanceObligationPayment` | Manual credit-card debt payment ("Borç öde" on the cards page card row, plus the obligations calendar item) | Debits a bank account, reduces `debt_amount`, then reduces statement debt before current-period spending; works before a statement is cut because payable = statement + current period |
| `pay_loan_installment` | `submitFinanceObligationPayment` | Pay loan installment | Debits a bank account, marks installment paid, syncs loan summary through DB invariants |
| `settle_personal_debt` | `submitFinanceObligationPayment` | Settle personal debt or collect receivable | Updates bank-account balance and closes the debt row |

`pay_card_installment` and `unpay_card_installment` are still typed RPCs, but
the current database definitions intentionally reject manual credit-card
installment payment outside the statement flow.

## Bank Accounts

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `transfer_between_accounts` | `submitAccountMovement` | Cards page/account center: bank-to-bank transfer | Moves money between two `banka_karti` accounts and writes history |
| `record_manual_account_movement` | `submitAccountMovement` | Cards page/account center: manual deposit/withdrawal | Applies one account balance delta and writes history in one transaction |
| `record_sms_account_movement` | `parse-sms` edge function (service role) | SMS automation: bank account in/out movement | Matches `cards.account_number` against the SMS account number (digits-only exact match, then tolerant mutual-containment match with a 6-digit minimum; ambiguous matches are rejected), applies the balance delta, and writes history |

## Ledger Repair

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `recompute_card_debt_from_ledger` | `recomputeCardDebt` | Card ledger panel repair | Resets `cards.debt_amount` to the exact card-ledger projection while suppressing a duplicate ledger event |
| `post_card_debt_correction` | `postCardDebtCorrection` | Card ledger panel correction | Applies a signed card debt adjustment; the card-ledger trigger records it as an auditable `adjustment` note |
| `recompute_account_balance_from_ledger` | `recomputeAccountBalance` | Account ledger panel repair | Resets bank-account balance to the exact account-ledger projection |
| `post_account_balance_correction` | `postAccountBalanceCorrection` | Account ledger panel correction | Applies a signed bank-account balance adjustment with an auditable note |

## Data Health

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `reset_user_finance_data` | `dataHealthRepo` | Data health: reset all finance data | Deletes the signed-in user's finance rows child-first |

Most other data-health fixes use direct table updates/deletes through
`dataHealthRepo`; they are not RPC-backed.

## Schema And Trigger Functions

These functions are database infrastructure, not direct app actions:

- `set_updated_at`
- `touch_updated_at`
- `record_card_debt_event`
- `record_account_balance_event`
- `private.debit_bank_account`
- `private.credit_bank_account`
- `clamp_card_breakdown`
- `sync_loan_summary`
- `derive_card_expense_installment_amount`
- `run_scheduled_card_maintenance`

If one of these changes, update the relevant business-rule document as well as
this reference when user-visible behavior changes.
