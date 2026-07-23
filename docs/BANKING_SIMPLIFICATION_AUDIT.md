# Banking Simplification Audit

## Fixed In This Pass

- **Unified installment entry (2026-07-02)**
  - Before: normal installment entry could not express already-paid installments, while old-installment carryover existed in a separate low-visibility panel.
  - Now: the main installment form has a "paid installments so far" field. Zero uses `add_card_expense`; a positive value routes to `record_card_installment_carryover`, keeps numbering such as 3/9, and adds only the remaining debt.

- **Credit-card row simplified (2026-07-02)**
  - Before: each credit-card row exposed status badges, consistency score, statement boxes, six visible actions, and always-visible SMS alias management.
  - Now: primary actions are "Borc ode" and "Harcama ekle"; import, reconciliation, installment entry, and detail live in the row menu. Consistency, aliases, statement day, and lower-frequency metadata live in the detail panel.

- **Card-first control center and archive-safe rebuild (2026-07-24)**
  - `/kartlar` summary now leads with statement, current-period, provision,
    scheduled-installment, and real-bank reconciliation status per credit card.
  - The existing live-reconciliation entry/fix flow is available directly below
    the control center for credit cards, rather than requiring a Data Health detour.
  - The old percentage is labeled "İç veri sağlığı" so it cannot be mistaken
    for bank reconciliation.
  - Clean import always preserves paid archives and their linked history; a
    current-movement PDF no longer creates a synthetic "mutabık" snapshot.
  - The destructive clean-import switch is no longer exposed. Statement and
    current-movement imports reconcile safely, preserve the bank's installment
    number/date, and let unmatched installment rows create the correct remaining
    plan after the total count is supplied.
  - Full pre-statement current-balance payments (the Yapı Kredi pattern) are
    allocated to posted movements through `card_current_settlements`; due
    installments become paid and settled rows cannot be billed again. Statement
    payment (the DenizBank pattern) continues to close its statement archive.

- **Classic banking affordances (2026-07-02)**
  - Before: bank accounts lacked shareable IBAN/copy UI, amount privacy, statement-like balance-after rows, recent row movements, and card-face masked numbers.
  - Now: bank accounts can store/copy IBAN, all major balances can be masked from one eye toggle, account ledger rows show "balance after", bank rows show the last three movements, and credit-card visuals use SMS alias digits for masked card numbers when available.

- **Data Health overdue statement payment (2026-07-02)**
  - Before: a statement paid at the real bank but left open in the app was easy to miss unless the user manually inspected cards.
  - Now: Data Health flags overdue open card statements and opens the shared statement-payment drawer directly from the issue card.

- **Bank account row actions consolidated (2026-07-02)**
  - Before: each bank account row showed three buttons ("Transfer yap", "Hareketler", "Para hareketi") with two separate modal entries.
  - Now: one "Para hareketi" button opens a single movement modal whose type selector covers money in, money out, and account-to-account transfer (transfer option is disabled without a second account). The ledger panel ("Hareketler") moved into the row's ⋮ menu.

- **Card installment payment vs card debt payment**
  - Before: an installment could be marked paid without selecting the account that funded it.
  - Now: installment payment requires a source bank account, debits that account, reduces card debt, and writes history.

- **Manual account movement vs bank-to-bank transfer**
  - Before: bank card actions only supported generic money in/out.
  - Now: account-to-account transfer is a first-class action through `transfer_between_accounts`.

- **Cards page information density**
  - Before: account balances, card overview, quick spending, provisions, installment migration, installment calendar, and installment payments were stacked with similar visual weight.
  - Now: the page starts with an account center, then credit card overview, then daily actions. Legacy installment migration is pushed into a lower-frequency details section.

- **Cards page module split**
  - Before: `CardsPage.tsx` mixed route orchestration with account center, expense entry, statements, installment migration, CRUD metadata, and account movement presentation.
  - Now: `CardsPage.tsx` is route composition; focused `CardsPage.*` modules own hooks, overview, expense entry, statements, list rows, installment migration, CRUD helpers, and movement modal presentation. See `docs/CARDS_ARCHITECTURE.md` for the current ownership map.

- **Navigation language**
  - Before: the route was labeled as only cards.
  - Now: navigation uses "Hesaplar" / "Hesaplar ve kartlar" to match bank-account management.

- **Loan installment payment**
  - Before: loan installments could be marked as paid without choosing a source account.
  - Now: unpaid loan installments expose one "Öde" action that opens the account-backed payment flow.

- **Primary app structure**
  - Before: daily banking screens, reporting, loans, assets, and data-health maintenance all competed in the main navigation.
  - Now: the primary navigation is reduced to "Özet", "Hesaplar", "Planlı", "Kişiler", "Raporlar", and "Diğer"; less frequent records and maintenance live under "Diğer".

- **Quick actions**
  - Before: the floating quick-action menu mixed daily money actions with data-health maintenance.
  - Now: quick actions are limited to creation/payment-style actions such as spending, transfer, planned payment, person debt/receivable, asset, and loan.

- **Dashboard focus**
  - Before: legacy installment migration and weekly data-health checks could appear as top focus cards even when no immediate user action was needed.
  - Now: focus cards prioritize due dates, cash gaps, limits, and real setup gaps; maintenance appears only when a concrete issue exists.

- **Account selection clarity**
  - Before: payment modals displayed only the local card/account name.
  - Now: account selectors include bank name and current balance so similarly named accounts are easier to distinguish.

- **Shared payment drawer plan**
  - Before: account-backed payments had a shared visual modal, but page-local state still duplicated account selection, last-used account, submit, and refresh behavior.
  - Now: `docs/SHARED_PAYMENT_DRAWER_PLAN.md` defines the migration path for one drawer/hook across planned payments, card statements/manual card debt, loan installments, and personal debt settlement.

- **Shared payment drawer phase 1**
  - Before: `PaymentsPage` owned its own payment drawer state even though it already used `FinanceObligation`.
  - Now: `PaymentsPage` uses `useFinancePaymentDrawer` and `FinancePaymentDrawer`; account eligibility, last-used account, submit, labels, and drawer validation are shared.

- **Shared payment drawer phase 2**
  - Before: `CardsPage.hooks.ts` owned a separate statement payment modal state and submit path.
  - Now: card statement payment opens the shared drawer from a statement `FinanceObligation`, preserving statement action loading, reloads, and schema-cache fallback copy.

- **Shared payment drawer phase 3**
  - Before: `LoansPage` called the loan-installment payment repository directly and owned separate modal state.
  - Now: loan installment payment opens the shared drawer from a `FinanceObligation`, preserving loan reloads, local installment reloads, and snapshot invalidation.

- **Shared payment drawer phase 4**
  - Before: `DebtsPage` called the personal-debt settlement repository directly and owned separate modal state.
  - Now: personal debt settlement and receivable collection open the shared drawer from `FinanceObligation`, preserving debt reloads, snapshot invalidation, and inflow/outflow account preview.

- **One account movement helper**
  - Manual deposit, withdrawal, transfer, bill payment, debt settlement, and loan payment all update balances and history.
  - Now: bank debit/credit row locking, ownership checks, type checks, balance validation, and balance updates are shared through internal `private.debit_bank_account` / `private.credit_bank_account` helpers, while each public RPC still owns its domain side effects and transaction-history insert.

- **Forecast reads normalized obligations**
  - Before: `cashFlowForecast` duplicated recurring payment, loan installment, card debt, card installment, and personal debt filters.
  - Now: forecast buckets are derived from `utils/obligations.ts`, so dashboard upcoming items, analysis calendar events, shared payment drawer intents, and forward cash projection agree on the same dated obligation rows.

- **Data reset preflight backup**
  - Before: "Tüm veriyi sil" warned that reset was irreversible, but the user had to remember to take a JSON backup first.
  - Now: the reset flow downloads a full `financeproject-sifirlama-oncesi` JSON backup before calling the destructive reset RPC; if backup fails, the reset does not start.

## Closeout Status

No P0 banking-simplification candidate remains open as of 2026-06-15. The
daily banking flows now share the account-backed payment drawer, bank-account
movement helpers, normalized obligation read model, clearer account/card
navigation, and safer data reset preflight backup.

Future work below is maintenance guidance, not an active P0 backlog item.

## Future Maintenance Notes

- **Planning model unification**
  - Recurring payments, loan installments, card statement debt, and card installments all appear as upcoming obligations.
  - The pure `utils/obligations.ts` view now feeds dashboard upcoming items, analysis calendar events, payment drawer intents, cash-flow forecast buckets, and dashboard monthly-load totals.
  - Reviewed in `docs/PLANNING_MODEL_REVIEW.md`: keep separate write tables and use `FinanceObligation` as the shared read-side projection.
  - Any future cleanup should be limited to dead-code and naming polish rather than a separate planning model.

- **Data-health maintenance UX polish**
  - Turkish copy and encoding are guarded, and the full-reset flow now has a preflight backup.
  - Future wording changes should stay concrete and action-oriented because this screen can modify real user data.
