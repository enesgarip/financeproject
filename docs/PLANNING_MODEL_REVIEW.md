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
- monthly cash-flow summaries

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

Forecast guardrail: running cash projections must subtract `cashImpactAmount`,
not raw `amount`, for credit-card-settled obligations. Scheduled card
installments are planning/card-debt rows, not immediate bank-cash outflows.

Analysis calendar guardrail: daily net totals must also use `cashImpactAmount`
instead of raw `amount`. The calendar can still list credit-card-settled loads
with their full `amount`, but the signed day total should represent bank-cash
movement.

Payments calendar guardrail: the `/odemeler` planned-load calendar uses the
same cash-impact semantics for "Ay yuku", "Beklenen giris", "Net etki", and
daily cash totals. Credit-card-settled rows can still be shown as card load, but
they must not inflate cash outflow.

## Completed Cleanup

- `buildMonthlyCashFlow` now reads payment/card/loan/debt buckets from the same
  `FinanceObligation` projection. The small payment/card helper rules needed by
  both `financeSummary.ts` and `obligations.ts` live in
  `src/utils/financeObligationRules.ts`, so the shared projection can be reused
  without a circular import.
- `summarizeFinanceObligations` and the payments-page obligation calendar now
  summarize by `cashImpactAmount`, so credit-card automatic payments and
  scheduled card installments remain visible without double-counting bank cash.

## Remaining Cleanup

The model is already unified enough for product behavior. Remaining work is
maintenance polish:

- Move any future planning math into `src/utils/obligations.ts` first, then
  adapt page-specific presentation around it.
- Keep legacy loan estimates (`legacy_loan_installment`) until every active loan
  reliably has `loan_installments`; do not mix legacy estimates with materialized
  rows for the same loan.
- Keep `docs/SHARED_PAYMENT_DRAWER_PLAN.md` aligned when new payable obligation
  kinds are added.
