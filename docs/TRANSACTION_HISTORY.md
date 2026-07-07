# Transaction History Side Effects

Last reviewed: 2026-07-07

This document is the source of truth for `transaction_history` side effects. Read
it before changing a finance mutation, RPC wrapper, payment drawer action, or
dashboard history display.

## Role

`transaction_history` is the user-facing activity feed. It is not the accounting
source of truth for balances or card debt:

- Card debt invariants come from `card_ledger`, card fields, statement archives,
  and card-installment state.
- Bank-account balance invariants come from `account_ledger` and `cards.current_balance`.
- `transaction_history` summarizes completed user-visible finance events for
  dashboard history, analysis grouping, price-increase radar, backup/restore, and
  audit context.

## Standard Contract

For new finance mutations, use these rules unless a domain document says
otherwise:

- Write history in the same database transaction as the state change. Do not
  update balances in one client call and insert history in a second client call.
- Public RPCs own the history insert. Internal helpers such as
  `private.debit_bank_account` and `private.credit_bank_account` must stay
  history-free.
- Write at most one history row per completed user action unless the user action
  clearly creates multiple independent events.
- Use positive TL `amount` values. Direction belongs in `type`, `title`, and
  `note`, not in a negative amount.
- Set `source_table` and `source_id` to the primary domain row the user acted on.
  For account-only movements, use the source bank-card row.
- Keep `title` short and user-readable. Put source account, due date, recurrence,
  or statement linkage details in `note`.
- Repairs that merely recompute from ledger projection should not add history;
  the ledger tables are the audit source for those corrections.

## Type Mapping

| Type | Use For |
| --- | --- |
| `payment` | Planned payments, card statement payments, manual card debt payments |
| `transfer` | Manual bank-account inflow/outflow and bank-to-bank transfer |
| `loan` | Loan installment payment |
| `debt` | Personal debt settlement or receivable collection |
| `card` | Card expense/provision/statement/carryover lifecycle events |
| `asset` | Asset buy/sell actions backed by a selected bank account |

## Current RPC Side Effects

| RPC / Flow | History Type | Source | Amount | Notes |
| --- | --- | --- | --- | --- |
| `add_card_expense` | `card` | `card_expenses.id` | Expense amount | Posted/provision/card-installment expense creation writes one card feed row. |
| `update_card_expense` | none | none | none | Rewrites a posted expense impact and installment rows; no new feed row today. |
| `post_card_provision` | `card` | Posted `card_expenses.id` | Posted amount | Partial posting writes the posted amount, not the original provision total. |
| `cancel_card_provision` | `card` | `card_expenses.id` | Provision amount | Cancellation remains visible because it reverses limit/balance impact. |
| `cut_card_statement` / `cut_due_card_statements` | `card` | `card_statement_archives.id` | Statement amount | Statement cutting logs the movement into billed debt; installments are not logged separately. |
| `record_card_installment_carryover` | `card` | Imported `card_expenses.id` | Remaining imported amount | Captures pre-app paid/remaining installment context in `note`. |
| `pay_payment` | `payment` | `payments.id` | Paid amount | Bank source debits cash; credit-card source creates posted card spending. |
| `pay_payment_from_card_import` | `payment` | `payments.id` | Paid amount | Statement/current movement import path for a matched planned payment; credit-card source creates posted card spending on the bank row date. |
| `post_due_card_auto_payments` | `payment` | `payments.id` | Paid amount | Maintenance wrapper reuses `pay_payment`, so the same feed row contract applies. |
| `pay_card_statement` | `payment` | `card_statement_archives.id` | Paid statement amount | Linked installments are marked paid but do not get separate history rows. |
| `pay_card_debt` | `payment` | `cards.id` | Paid amount | Manual/legacy card debt payment; future scheduled installments are not closed. |
| `pay_loan_installment` | `loan` | `loan_installments.id` | Installment amount | Bank source is recorded in `note`; loan summary sync is DB-owned. |
| `settle_personal_debt` | `debt` | `debts.id` | `estimated_value_try` | Covers both paying debt and collecting receivable; direction is in `note`. |
| `record_manual_account_movement` | `transfer` | `cards.id` | Movement amount | Manual bank-account in/out uses the affected account as source. |
| `transfer_between_accounts` | `transfer` | Source `cards.id` | Transfer amount | One feed row represents both debit and credit sides. |
| `trade_asset_with_account` | `asset` | `assets.id` | Trade amount | Buy debits the selected bank account; sell credits it. Asset value/quantity updates and account balance movement commit together. |
| `reset_card_data` | deletes scoped history | Related card rows | n/a | Removes history tied to deleted card expenses/installments/statements. |
| `reset_card_import_data` | deletes scoped history | Open/current import rows | n/a | Removes history tied to the open/current import scope only; paid historical statement archives and their linked rows stay available for reports. |
| `reset_user_finance_data` | deletes all user history | User data reset | n/a | Full reset removes the feed with the rest of the user's finance data. |
| Ledger recompute/correction RPCs | none | Ledger tables | none | Card/account ledgers are the audit trail; dashboard history is not duplicated. |
| Data Health direct fixes | none | Direct table updates/deletes | none | Safe-fix preview/undo is Data Health state, not activity feed history. |

## Change Checklist

When changing a mutation side effect:

1. Update the RPC implementation or repository/service wrapper.
2. Update `docs/RPC_ACTION_REFERENCE.md` if the user-visible action, RPC
   contract, or main effect changes.
3. Update this file if `type`, `source_table`, `source_id`, amount semantics, or
   write/delete behavior changes.
4. Check dashboard history and analysis consumers that group by `type` or
   `source_id`.
5. Run at least `git diff --check`; for code changes also run targeted tests,
   `npm run test:unit`, `npm run lint`, and `npm run build`.
