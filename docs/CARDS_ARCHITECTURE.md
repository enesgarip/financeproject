# Cards Architecture Note

Last reviewed: 2026-08-09

This note maps `/kartlar` (`CardsPage`) after the page split. Start with
`CLAUDE.md`, `docs/AI_CONTEXT_INDEX.md`, and `docs/CARD_DEBT_TRANSITIONS.md`
before changing card debt, statement, provision, installment, or account
movement behavior.

## Responsibility

`src/pages/CardsPage.tsx` is route orchestration. It should compose the card
sections, connect shared drawers/modals, and coordinate reloads after actions.

It should not become the owner of new debt math, statement cycle rules, ledger
projection, or Supabase access. Keep those in existing utilities,
repositories, services, or focused `CardsPage.*` modules.

## Module Map

- `CardsPage.tsx`: route composition, drawer/modal wiring, section rendering
- `CardsPage.hooks.ts`: section URL state, page data loading, provision and
  statement action state, account movement modal state
- `CardsPage.sections.tsx`: section navigation and due-statement automation
- `CardsPage.overview.tsx`: account hub and credit-card overview panels
- `CardsPage.control.tsx`: card-first control center; combines statement/current/
  provision/scheduled-installment buckets with the latest real-bank debt
  reconciliation and exposes import/reconciliation actions
- `components/finance/LiveReconciliationPanel.tsx`: reused on the cards summary
  with credit-card rows only. It accepts the bank's total remaining card burden
  including future installments and uses the total-only bank snapshot RPC;
  payment/account debit remains a separate explicit action
- `CardsPage.expense.tsx`: quick expense and installment expense entry
  surface; loads editable repeat suggestions for recent cash expenses and
  routes paid-count installment imports to `record_card_installment_carryover`
- `CardsPage.statements.tsx`: open statement and provision presentation panels
- `CardsPage.list.tsx`: account/card list item presentation, row action menus,
  bank IBAN/copy affordance, masked card number, recent bank movements, and
  ledger/detail panels
- `CardsPage.installment.tsx`: legacy installment migration fallback/reference;
  the primary user flow is now the unified installment form in
  `CardsPage.expense.tsx`
- `CardsPage.crud.tsx`: CRUD form mapping, grouping, row actions, list metadata
- `CardsPage.helpers.ts`: card-specific pure helpers and date/month utilities
- `CardsPage.movementModal.tsx`: account movement modal presentation
- `components/finance/StatementImportModal.tsx`: statement PDF reconciliation/import flow
- `components/finance/CurrentMovementImportModal.tsx`: DenizBank current movement
  PDF reconciliation review/import flow

Keep new UI in the closest focused module. Add a new module only when an
existing module would start mixing unrelated responsibilities.

Both PDF import modals are loaded through `src/lib/lazyWithReload.ts` only when
their selected-card state is open. Keep these tools out of the initial
`CardsPage` chunk; use the same designed loading overlay when changing their
lazy boundary.

## Visual Hierarchy

- `CrudPage` supplies the shared `PageCommandHeader`; `/kartlar` labels this
  surface "Finans merkezi" and keeps search/create tools in the same command
  layer.
- On the summary section, `AccountHubPanel` is the first persistent decision
  surface. It shows account balance, payable card debt, and "borç sonrası
  nakit" (`diffTL(accountBalance, payableCardDebt)`) before reconciliation and
  detailed card panels.
- `accounts-signature-hub` is a scoped dark signature surface in both app
  themes. Keep its foreground/card contrast tokens local.
- Account and credit-card list surfaces use the shared `premium-entity-card`
  anatomy: identity, one primary value, supporting metrics/activity, then the
  primary action. Their list is capped at two desktop columns so balance,
  movement, statement, and limit information never collapses into a narrow
  tile.
- The credit-card signature surface must leave overflow visible because the row
  action menu is anchored inside it. Keep decorative clipping on the dedicated
  absolute decoration layer so mobile menus can extend beyond the blue surface.
- Credit-card list rows label `debt_amount` as “Toplam kart yükü”; current-period,
  open-statement, and future-installment amounts remain separate supporting
  values so a bank's zero current debt is not mistaken for zero total burden.
- Do not render `CreditCardOverview` when there is no credit-card limit group;
  the account hub already owns cash-only summary.

## Data And Side Effects

Card page table CRUD still flows through `CrudPage`, but finance-specific
actions should use the repository/service layer:

- card/provision/statement reads and provision actions:
  `src/data/repositories/cardsRepo.ts`
- quick-expense repeat suggestions read the latest posted expenses through
  `fetchRecentCardExpenses`; `src/utils/expenseRepeat.ts` excludes installment
  and provision flows, deduplicates descriptions, and keeps suggestion
  selection as pure presentation logic until the user submits the form
- current movement reconciliation parses PDFs in
  `src/utils/denizBankMovementParser.ts`, matches ordinary expenses and
  installment rows via `fetchCardExpenseMatchRows` /
  `fetchCardInstallmentMatchRows`, shows collapsed bank/app pairs in the review
  UI, and writes spending through `add_card_expense` or
  `record_card_installment_carryover`
- statement/current movement imports also load planned-payment match rows via
  `fetchCardPaymentMatchRows`; when a bank row matches a still-open planned
  payment, the import calls `pay_payment_from_card_import` so the card expense
  and payment recurrence/status update happen in one RPC instead of double
  counting the bill as both card spending and a pending obligation
- DenizBank statement rows ending with `+ TL` are credits/refunds. Statement
  import shows them as selectable "alacak/iade" rows and applies them through
  `post_card_debt_correction` so the card debt is reduced with an audited
  reverse entry instead of importing the row as spending.
- Statement import treats the validated PDF as the authoritative snapshot through
  its statement date. `replace_card_statement_import` rebuilds that open scope,
  cuts/reconciles it, and rolls back as one transaction on any row/date failure;
  paid/current-settled history and later movements remain untouched. It does not
  query or reuse an old installment parent: a PDF `3/6` row creates only the
  current `3/6` plus future `4/6..6/6` open plan. Current-
  movement import stays non-destructive because that PDF has no independent debt
  total. The lower-level `reset_card_import_data` remains a guarded maintenance RPC.
- Both importers use `src/utils/importedInstallmentPlan.ts` to preserve the
  original bank transaction date, derive the exact current installment date,
  and retain numbering such as 5/12 instead of rebuilding it as 1/8.
- Current-movement PDFs do not provide an independent real-bank total debt.
  Rebuilding from such a PDF must therefore not write a synthetic zero-drift
  `account_reconciliations` row. The card control center can say "Bankayla
  mutabık" only after a real bank amount was captured.
- account deposit, withdrawal, and account-to-account transfer:
  `src/services/accountMovements.ts`
- card/account ledger recomputation actions:
  `src/services/cardLedgerActions.ts` and `src/services/accountLedgerActions.ts`
- account-backed payments:
  `src/hooks/useFinancePaymentDrawer.ts` and
  `src/components/finance/FinancePaymentDrawer.tsx`
- balance privacy:
  `src/hooks/useBalancePrivacy.ts`; pass its formatter down instead of adding
  page-local masking logic

Do not import `src/lib/supabase` from page, component, hook, or utility code.
If a new query is needed, add it to the repository or service layer.

For old installment plans that started before the app, do not expose a second
top-level migration panel by default. The quick installment form has a
"paid installments so far" field: zero uses `add_card_expense`; a positive
value uses `record_card_installment_carryover`, records the number on the parent
note, creates only current/future open rows, and adds only the remaining debt.

## Card Debt Boundaries

Before changing any of these fields, read `docs/CARD_DEBT_TRANSITIONS.md`:

- `debt_amount`
- `statement_debt_amount`
- `current_period_spending`
- `provision_amount`
- `card_installments`
- `card_statement_archives`
- `card_current_settlements`

Frontend helpers may display or validate these values, but durable balance
changes should be append-only ledger/RPC actions. Data fixes should prefer
reverse entries or recomputation paths over mutating historical events.

## Shared Payment Flow

Statement payment uses the shared finance payment drawer by building a
`FinanceObligation` for the statement and submitting through the shared action
path. Keep new account-backed card payments on this path unless the RPC contract
is materially different.

Manual card debt payment follows the same pattern: the "Borç öde" button on a
credit-card row (`CardsPage.openDebtPayment`) builds a `pay_card_debt`
obligation with an editable amount defaulting to `cardPayableDebt(card)`, so
debt can be paid from a bank account before the statement is cut. The RPC caps
the amount at statement + current-period debt and reduces statement debt first.
The button is disabled while the card has an open statement archive; that case
belongs to the statement payment flow, because `pay_card_debt` does not close
archive rows.

If there is no statement debt and the user pays the exact full current-period
amount, `pay_card_debt` records a `card_current_settlements` row and allocates
the payment to posted, unstatemented movements. Due installment rows become
paid, future scheduled installments remain scheduled, and allocated movements
are excluded from subsequent statement cuts. Settled historical rows are
guarded against update/delete.

The shared payment modal may provide amount shortcuts, but the RPC remains the
authority. For card debt payment the shortcuts are presentation-only
("estimated minimum" and "full amount") and still submit through the same
editable amount field.

When a card action changes balances or statement/installment state, refresh:

- the card CRUD rows
- statement archives
- provisions
- card installments
- the finance snapshot cache

## Verification

For card page changes, usually run:

```bash
npm exec -- vitest run src/pages/CardsPage.helpers.test.ts src/utils/financeSummary.test.ts src/utils/cardStatement.test.ts
npm run lint
npm run test:unit
npm run build
```

For RPC, RLS, or migration changes, also run the local Supabase checks from
`docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` when available.
