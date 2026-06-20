# Cards Architecture Note

Last reviewed: 2026-06-15

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
- `CardsPage.expense.tsx`: quick expense and installment expense entry surface
- `CardsPage.statements.tsx`: open statement and provision presentation panels
- `CardsPage.list.tsx`: account/card list item presentation
- `CardsPage.installment.tsx`: legacy installment migration UI
- `CardsPage.crud.tsx`: CRUD form mapping, grouping, row actions, list metadata
- `CardsPage.helpers.ts`: card-specific pure helpers and date/month utilities
- `CardsPage.movementModal.tsx`: account movement modal presentation
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
  only through `add_card_expense`
- account deposit, withdrawal, and account-to-account transfer:
  `src/services/accountMovements.ts`
- card/account ledger recomputation actions:
  `src/services/cardLedgerActions.ts` and `src/services/accountLedgerActions.ts`
- account-backed payments:
  `src/hooks/useFinancePaymentDrawer.ts` and
  `src/components/finance/FinancePaymentDrawer.tsx`

Do not import `src/lib/supabase` from page, component, hook, or utility code.
If a new query is needed, add it to the repository or service layer.

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
