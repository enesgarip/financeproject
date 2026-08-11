# Supabase RPC Action Reference

Last reviewed: 2026-08-09

This file maps Supabase RPCs to the user-visible actions that call them. Keep it
updated whenever a page action, repository wrapper, or migration changes an RPC
contract.

For `transaction_history` side effects, type/source conventions, and no-history
repair rules, keep `docs/TRANSACTION_HISTORY.md` aligned with this file.

## Daily Maintenance

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `post_due_card_installments` | `runFinanceMaintenance`, `run_scheduled_card_maintenance` | App open/server daily maintenance | Moves scheduled card installments whose exact due date has passed into `current_period_spending`; returns processed row count |
| `cut_due_card_statements` | `runFinanceMaintenance`, `cutDueCardStatements` | App open/cards page maintenance | Cuts any due credit-card statements for the signed-in user after due installments have been posted; cards whose spending belongs entirely to the next statement are skipped without error; returns cut count |

## Cards And Statements

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `add_card_expense` | `addCardExpense` in `cardsRepo` | Cards page: add card expense/provision/installment expense | Inserts `card_expenses`; updates credit-card `debt_amount`, `current_period_spending`, and/or `provision_amount`; bank-card spending debits `current_balance`. Optional `p_source_event_id` makes a retry return the existing row without repeating any financial effect. |
| `update_card_expense` | `updateCardExpense` in `cardsRepo` | Cards page: edit an unstatemented posted expense | Reverses previous posted impact, writes new expense values, recreates installment rows. Rejects a directly archived expense or an installment parent with any archived child. |
| `post_card_provision` | `applyCardProvision` in `cardsRepo` | Cards page: post a provision | Moves all or part of a provision into posted current-period spending |
| `post_due_card_installments` | Finance maintenance | Time-based installment posting | Changes due scheduled card-installment rows to `posted` and adds their amount to current-period spending without changing total debt |
| `cancel_card_provision` | `applyCardProvision` in `cardsRepo` | Cards page: cancel a provision | Removes provision from card debt/limit impact and marks the expense `cancelled` |
| `cancel_card_expense` | `cancelCardExpense` in `cardsRepo` | Reconciliation: cancel any expense | Cancels a posted or provision expense, reverses total debt plus the exact visible split bucket, removes installments, logs correction |
| `cut_card_statement` | `cutCardStatement` in `cardsRepo` | Low-frequency/manual statement cut helper | Creates or returns the period archive and moves current-period spending into open statement debt; eligible child rows are attached under a transaction-local guarded context so direct reassignment cannot bypass aggregate movement |
| `set_statement_reconciliation` | `setStatementReconciliation` in `cardsRepo` | Statement import/reconciliation | Stores bank statement reconciliation amount and note for a card period |
| `pay_payment_from_card_import` | `payPaymentFromCardImport` in `cardsRepo` | Statement/current movement import: matched planned payment row | Adds the matched bill as posted credit-card spending on the bank row date and advances/closes the planned payment; source event retries are no-ops. |
| `record_card_installment_carryover` | `recordCardInstallmentCarryover` in `cardsRepo` | Cards page/import: current installment number is greater than one | Adds only current/future open installment rows and remaining card debt; earlier installments are represented by the parent note, not recreated as synthetic paid rows. Source event retries do not recreate the plan. |
| `reset_card_import_data` | `resetCardImportData` in `cardsRepo` | Guarded maintenance helper (the import UI no longer exposes destructive clean import) | Clears only the non-paid/open working scope under a user/card-bound DB context. It fails before mutation when current-settlement or paid-statement installment history would require reconstructing immutable evidence. |
| `replace_card_statement_import` | `replaceCardStatementImport` in `cardsRepo` | Statement PDF import | In one transaction preserves immutable history/later movements, replaces the PDF-covered open scope, applies refunds, locks the cut amount to the bank total, cuts the statement, and records reconciliation. Historical installment parents are never matched/reused; the PDF creates a fresh current/future open plan. |

`reset_card_data` and its repository helper were removed in the 2026-08-02
hardening pass because that legacy RPC could not safely erase immutable statement/
current-settlement evidence. Full user reset is the supported destructive reset.

The detailed field transitions for these RPCs live in
`docs/CARD_DEBT_TRANSITIONS.md`.

Statement import also uses `post_card_debt_correction` for DenizBank `+ TL`
credit/refund rows so the net statement total matches the bank archive without
rewriting historical expenses.

## Payments And Obligations

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `pay_payment` | `submitFinanceObligationPayment` | Planned payments page/dashboard obligation modal | Marks one payment paid or advances monthly recurrence; bank source debits `current_balance`, credit-card source increases `debt_amount` / `current_period_spending` and creates posted card spending |
| `pay_card_statement` | `submitFinanceObligationPayment` | Pay open credit-card statement | Uses the archived bank amount, debits the source account, marks the statement paid, reduces card debt, and reprojects statement debt from remaining open archives. It does not mutate linked installments and aggregate drift does not block payment. |
| `pay_card_debt` | `submitFinanceObligationPayment` | Manual credit-card debt payment ("Borç öde" on the cards page card row, plus the obligations calendar item) | Debits a bank account and reduces card debt. A full current-period payment uses a payment settlement. Exact pre-cycle excess left by a legacy aggregate payment first enters a source-less `historical_repair` settlement without a second debit; ambiguous movement sets reject and roll back the whole payment. Direct child marker writes remain rejected. |
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
| `record_sms_account_movement` | `parse-sms` edge function (service role only) | SMS automation: bank account in/out movement | Matches `cards.account_number` against the SMS account number (digits-only exact match, then tolerant mutual-containment with a 6-digit minimum; ambiguous/cross-user global matches are rejected), applies the balance delta, and writes history at the explicit Turkey-offset SMS time. Optional `p_source_event_id` makes retries no-ops under the card lock + unique index. Minute-only SMS requires an external stable event ID. |
| `record_sms_card_expense` | `parse-sms` edge function (service role only) | SMS automation: credit-card expense | Makes the SMS event idempotent, reconciles one unambiguous same-card/near-date/tolerant-amount `bank_auto` payment and advances its recurrence, or attaches a late SMS to the already-posted automatic fallback. Ambiguous candidates are not guessed. |

## Assets

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `trade_asset_with_account` | `submitAssetTrade` | Assets page: buy/sell an existing asset with a selected bank account | Buy debits a `banka_karti` and increases asset value/quantity; sell credits a `banka_karti` and decreases asset value/quantity; writes one asset history row |

## Ledger Repair

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `recompute_card_debt_from_ledger` | `recomputeCardDebt` | Card ledger panel repair | Resets `cards.debt_amount` to the exact card-ledger projection while suppressing a duplicate ledger event |
| `post_card_debt_correction` | `postCardDebtCorrection` | Card ledger panel correction | Applies a signed card debt adjustment; the card-ledger trigger records it as an auditable `adjustment` note |
| `reconcile_card_bank_snapshot` | `reconcileCardBankSnapshot` | Cards summary / live reconciliation | Sets total debt to the bank's total remaining card burden without changing visible buckets; repairs only exact historical paid-statement allocation gaps and records an auditable ledger adjustment |
| `recompute_account_balance_from_ledger` | `recomputeAccountBalance` | Account ledger panel repair | Resets bank-account balance to the exact account-ledger projection |
| `post_account_balance_correction` | `postAccountBalanceCorrection` | Account ledger panel correction | Applies a signed bank-account balance adjustment with an auditable note |

## Data Health

| RPC | Called From | User-Visible Action | Main Effect |
| --- | --- | --- | --- |
| `apply_data_health_safe_repairs` | `dataHealthRepairs` / `DataHealthPage.actions` | Individual source recompute / previewed card-account bulk repair | Applies one 1..100-entry, duplicate-free card/account or loan domain plan after owner/type locks and exact `updated_at` validation; stale input rolls back the domain plan, while canonical request-bound idempotency returns the original receipt on replay |
| `update_card_expense_health_metadata` | `cardsRepo` / `DataHealthCardExpenseReview` | Complete flagged description/category | Locks card → expense, rejects stale/cancelled rows, and updates only non-financial metadata without changing archive totals |
| `reset_user_finance_data` | `dataHealthRepo`, `backupRepo` | Data health reset / restore pre-wipe | In one auth.uid-bound transaction deletes the signed-in user's finance/support rows child-first, safely breaks settlement RESTRICT links, and clears repair receipts plus owner SMS/notification logs while preserving ownerless diagnostics |

The bulk planner excludes `loanTotals`; an individual loan finding submits a
loan-only plan so card and loan lock domains are never mixed. Each accepted new
plan records one `data_health_repair_runs` row. Applied/skipped targets receive
per-target `data_health_repair_steps` before/after receipts; a pre-mutation
conflict/failure records one diagnostic step without fabricated snapshots.
Authenticated clients have own-row SELECT only on those tables.

Remaining guarded technical fixes use optimistic singleton updates through
`dataHealthRepo`. Structural card-plan changes and ambiguous financial truth are
sent to canonical domain/reconciliation actions instead of direct updates.

## Schema And Trigger Functions

These functions are database infrastructure, not direct app actions:

- `set_updated_at`
- `touch_updated_at`
- `record_card_debt_event`
- `record_account_balance_event`
- `private.debit_bank_account`
- `private.credit_bank_account`
- `private.guard_current_settlement_allocation`
- `clamp_card_breakdown`
- `sync_loan_summary`
- `derive_card_expense_installment_amount`
- `run_scheduled_card_maintenance`

If one of these changes, update the relevant business-rule document as well as
this reference when user-visible behavior changes.
