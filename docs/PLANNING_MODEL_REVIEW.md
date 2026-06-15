# Planning Model Review

Last reviewed: 2026-06-15

## Decision

Do not add a new shared planning table for recurring payments, loan
installments, and card installments right now. Keep their persistence models
separate, and treat `src/utils/obligations.ts` as the canonical read-side
projection for dated planning rows.

In practice, the shared model is `FinanceObligation`:

- dashboard upcoming items
- dashboard monthly load totals
- analysis calendar events
- payments-page obligation calendar
- shared payment drawer intents
- cash-flow forecast buckets

All of those surfaces should continue to consume `buildFinanceObligationsForMonth`
or `buildFinanceObligationsForRange` instead of re-implementing date/amount
rules locally.

## Why Not One Table

The three source domains have different lifecycle semantics:

- `payments` are user-entered planned commitments. Monthly recurrence is a rule
  on the row, and `pay_payment` advances or closes the payment.
- `loan_installments` are materialized debt-schedule rows. Paying one row also
  syncs the parent loan summary through database invariants.
- `card_installments` are future credit-card debt staging rows. They are not
  direct cash outflows and should settle through card statement payment, not an
  independent "pay installment" action.

Flattening these into one write table would hide important domain invariants and
make side effects less obvious. The safer unification point is a pure projection
that normalizes date, amount, cash impact, source id, action, and settlement.

## Projection Contract

Every planning surface should preserve these meanings:

- `amount`: the dated obligation amount shown to the user.
- `cashImpactAmount`: the cash movement for that date. Credit-card-settled
  obligations and scheduled card installments can be `0` even when `amount` is
  positive.
- `settlement`: `cash` for bank-account cash movement, `credit_card` for
  obligations that first land on a card.
- `action`: non-null only when the item can be paid/settled from the shared
  payment drawer.
- `isEstimate`: true when the row is projected or valuation-dependent rather
  than a committed exact amount.

Guardrail: do not re-enable direct card-installment payment in the shared
drawer. Card installments become payable through the statement archive that
contains them.

## Remaining Cleanup

The model is already unified enough for product behavior. Remaining work is
maintenance polish:

- Move any future planning math into `src/utils/obligations.ts` first, then
  adapt page-specific presentation around it.
- If `buildMonthlyCashFlow` in `src/utils/financeSummary.ts` is refactored, avoid
  a circular import with `obligations.ts`; extract only the small shared date or
  cash-impact helpers needed by both modules.
- Keep legacy loan estimates (`legacy_loan_installment`) until every active loan
  reliably has `loan_installments`; do not mix legacy estimates with materialized
  rows for the same loan.
- Keep `docs/SHARED_PAYMENT_DRAWER_PLAN.md` aligned when new payable obligation
  kinds are added.
