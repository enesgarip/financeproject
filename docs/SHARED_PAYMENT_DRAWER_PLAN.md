# Shared Payment Drawer Plan

Last reviewed: 2026-06-14

## Goal

Unify account-backed payment flows behind one drawer contract without changing
the money rules or RPC behavior. The current `AccountPaymentModal` already
handles the visual surface, amount validation, account coverage preview, and
submit button state. The missing layer is shared page orchestration: opening an
intent, choosing eligible source accounts, remembering the preferred account,
submitting through the right service, surfacing errors, and refreshing the
right data after success.

## Current Surfaces

| Surface | Current Entry | Submit Path | Account Rules | Notes |
| --- | --- | --- | --- | --- |
| Planned payment | `PaymentsPage.openObligationPayment` | `submitFinanceObligationPayment` -> `pay_payment` | Bank account or credit card | Amount is editable because estimates can be paid with the real amount. |
| Credit-card statement | `CardsPage.hooks.useStatementPaymentModal` | `submitFinanceObligationPayment` -> `pay_card_statement` | Bank account only, not the target credit card | Statement payment also marks linked card installments paid. |
| Manual card debt | `ObligationsCalendar` -> `PaymentsPage.openObligationPayment` | `submitFinanceObligationPayment` -> `pay_card_debt` | Bank account only, not the target card | Amount is editable but cannot exceed payable card debt. |
| Card installment | `ObligationsCalendar` | No direct action | N/A | Scheduled installments are paid by statement flow; manual `pay_card_installment` remains intentionally disabled. |
| Loan installment | `LoansPage.openInstallmentPayment` | `payLoanInstallment` repo wrapper | Bank account only | Uses a page-local modal state and `loanAccount` preference. |
| Personal debt/receivable | `DebtsPage.openDebtSettlement` | `settlePersonalDebt` repo wrapper | Bank account only | Receivable collection is an inflow, so account preview must add funds instead of checking coverage. |

## Proposed Shape

Keep `AccountPaymentModal` as the low-level UI and introduce a single
finance-specific wrapper:

- `src/hooks/useFinancePaymentDrawer.ts`
  - Owns `intent`, `accounts`, selected account id, amount text, saving state,
    external error, and close/reset behavior.
  - Opens with a `FinanceObligation` plus page refresh callbacks.
  - Uses `getAccountsForObligation`, `lastUsedKeyForObligation`,
    `resolvePreferred`, and `submitFinanceObligationPayment`.
  - Stores the last used account only after successful submit.
  - Lets the caller provide already-loaded cards, or a lazy loader when the page
    does not have card data in memory.
- `src/components/finance/FinancePaymentDrawer.tsx`
  - Wraps `AccountPaymentModal`.
  - Derives title, labels, empty-state copy, editability, success tone, and
    statement/debt-specific validation from the `FinanceObligation`.
  - Renders optional intent detail lines supplied by the hook caller.

Suggested hook API:

```ts
type PaymentDrawerOpenOptions = {
  cards?: Card[]
  loadCards?: () => Promise<Card[]>
  reload?: () => Promise<void>
  afterSuccess?: () => Promise<void>
  detail?: ReactNode
}

function useFinancePaymentDrawer() {
  return {
    drawerProps,
    openPaymentDrawer,
    closePaymentDrawer,
  }
}
```

The hook receives refresh behavior per open call through `reload` and
`afterSuccess`, keeping route reloads, snapshot invalidation, and page-local
list refreshes explicit at each call site. The preferred account source is
explicit page-owned `cards`; `loadCards` is only for pages that do not already
have card data in memory.

## Implementation Status

- 2026-06-14: Phase 1 complete. Added `useFinancePaymentDrawer` and
  `FinancePaymentDrawer`, then migrated `PaymentsPage` to the shared drawer.
- Next slice: migrate `CardsPage` statement payment onto the shared drawer while
  preserving statement action ids and statement/installment reloads.

## Migration Order

1. **Extract without behavior change.** Done 2026-06-14.
   `PaymentsPage` now uses `useFinancePaymentDrawer` and
   `FinancePaymentDrawer` because it already used `FinanceObligation` and
   `submitFinanceObligationPayment`.
2. **Move card statement payment onto the drawer.**
   Replace `useStatementPaymentModal` with a small statement-to-obligation
   builder plus the shared drawer. Keep the statement action id/loading state in
   `CardsPage.hooks.ts` until statement panels are simplified further.
3. **Move loan installment payment onto obligations.**
   Build a `FinanceObligation` from `LoanInstallment` and submit through
   `submitFinanceObligationPayment` instead of calling `payLoanInstallment`
   directly from the page. Keep loan plan edit/delete behavior untouched.
4. **Move personal debt settlement onto obligations.**
   Build `settle_debt` / `collect_debt` obligations in `DebtsPage` and submit
   through the shared drawer. Preserve receivable inflow preview
   (`accountPreviewAmount = -amount`).
5. **Delete duplicate page state.**
   Remove page-local selected-account, amount, saving, error, and last-used
   plumbing once every page uses the hook.

## Guardrails

- Do not re-enable direct card-installment payment. Card installments settle
  through statement payment; this keeps `docs/CARD_DEBT_TRANSITIONS.md`
  accurate.
- Do not call Supabase directly from pages or components. The drawer submits
  through `services/financePaymentActions.ts`.
- Preserve bank-only source rules for statement, manual card debt, loan
  installment, and personal debt. Planned payments are the only current flow
  that can use a credit card as the source.
- Keep `pay_card_debt` overpayment validation with `exceedsTL`; do not add
  ad-hoc `+0.01` tolerances.
- Each migration step should keep its page refresh behavior explicit:
  route reload, finance snapshot invalidation, and any local installment or
  statement reloads.

## Verification

For each implementation slice:

- `npm run lint`
- `npm run test:unit`
- `npm run build`

Add or update focused tests around `financePaymentActions` helper functions
when labels, account eligibility, editability, or validation rules move into
the drawer layer. Browser smoke is useful after the first UI migration, but it
requires an authenticated session to exercise the payment flows.
