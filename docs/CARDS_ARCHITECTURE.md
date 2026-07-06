# Cards Architecture Note

Last reviewed: 2026-07-02

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
- `CardsPage.expense.tsx`: quick expense and installment expense entry
  surface; routes paid-count installment imports to
  `record_card_installment_carryover`
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

## Data And Side Effects

Card page table CRUD still flows through `CrudPage`, but finance-specific
actions should use the repository/service layer:

- card/provision/statement reads and provision actions:
  `src/data/repositories/cardsRepo.ts`
- current movement reconciliation parses PDFs in
  `src/utils/denizBankMovementParser.ts`, matches via
  `fetchCardExpenseMatchRows`, shows the detected period's app spending
  history plus collapsed matched bank/app pairs in the review UI, and writes
  spending through `add_card_expense`
- statement/current movement imports also load planned-payment match rows via
  `fetchCardPaymentMatchRows`; when a bank row matches a still-open planned
  payment, the import calls `pay_payment_from_card_import` so the card expense
  and payment recurrence/status update happen in one RPC instead of double
  counting the bill as both card spending and a pending obligation
- DenizBank statement rows ending with `+ TL` are credits/refunds. Statement
  import shows them as selectable "alacak/iade" rows and applies them through
  `post_card_debt_correction` so the card debt is reduced with an audited
  reverse entry instead of importing the row as spending.
- Clean import in statement/current-movement modals uses
  `reset_card_import_data`, not the destructive `reset_card_data` flow. It
  clears the open/current import scope and preserves paid historical statement
  archives plus the old rows linked to those archives, so reports keep their
  history.
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
value uses `record_card_installment_carryover`, writes the already-paid rows as
paid history, and adds only the remaining debt.

## Card Debt Boundaries

Before changing any of these fields, read `docs/CARD_DEBT_TRANSITIONS.md`:

- `debt_amount`
- `statement_debt_amount`
- `current_period_spending`
- `provision_amount`
- `card_installments`
- `card_statement_archives`

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
