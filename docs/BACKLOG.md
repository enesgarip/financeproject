# Priority Backlog

## P0 - High Confidence / High Value

- Break large finance-heavy page files into smaller domain modules without changing behavior.
  - Highest candidates: `LoansPage.tsx`, `AnalysisPage.tsx`, `DataHealthPage.tsx`, `CardsPage.tsx`
- Finish Faz C money cleanup (ledger integer-kuruş conversion).
  - Remaining real work: migrate residual float TL ledger arithmetic to signed integer kuruş at the repo/data layer.
  - Rounding/comparison sweep is DONE: all TL sums route through `roundMoney`→`roundTL`, and `+0.01` tolerances now use `exceedsTL`/`moneyDiffers`. The remaining bare `Math.round(x*100)/100` sites (`fire`, `realValue`, `marketRates`, `goldLedger`) are intentionally NOT money (display/rate/quantity precision) and are commented as such — do not route them through `money.ts`.
- Maintain the documented source of truth for card debt transitions in `docs/CARD_DEBT_TRANSITIONS.md`.
  - expense added
  - provision posted
  - statement cut
  - debt paid
- Continue banking simplification from `docs/BANKING_SIMPLIFICATION_AUDIT.md`.
  - shared account movement helper/RPC family
  - normalized upcoming obligations view

## P1 - Product / Reliability

- Reduce fallback logic that depends on missing Supabase schema cache or missing RPC deployment.
- Improve visibility of migration/version mismatches between frontend expectations and live database state.
- Document and standardize transaction history side effects for all finance mutations.
- Review whether recurring payments, loan installments, and card installments can be unified under a clearer planning model.

## P2 - UX / Maintainability

- Add a concise developer-oriented architecture note for each major page.
- Keep `docs/AI_CONTEXT_INDEX.md` current so future AI sessions can route to the right files with less repo scanning.
- Reduce repeated money helper logic such as `roundMoney`, split-total helpers, and schema-cache checks.
- Clarify where dashboard calculations belong versus page-local calculations.
- Audit Turkish copy and encoding consistency across UI strings and docs.

## P3 - Nice to Have

- Add guided import/restore flow for personal finance data. JSON/CSV export now exists in the data health screen.
- Add stronger historical analytics for cash flow and debt trend.
- Add better scenario planning around next-month and multi-month obligations.

## Suggested Next Tasks for Codex

1. Plan the shared account movement helper/RPC family across manual deposit, withdrawal, transfer, bill payment, debt settlement, and loan payment.
2. Keep `docs/RPC_ACTION_REFERENCE.md` aligned when Supabase RPCs or user-visible actions change.
3. Keep `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` aligned with release workflow changes.
4. Continue shrinking the remaining large route files (`LoansPage.tsx`, `AnalysisPage.tsx`, `DataHealthPage.tsx`) with behavior-preserving module extracts.

## Recently Cleared / No Longer First Next Task

- Targeted tests now exist for `cardStatement`, `budgetAlerts`, and savings goal progress.
- `financeSummary.test.ts` covers shared credit limit grouping, payable card debt excluding provision, and recurring payment month occurrence.
- A narrow Faz C pass replaced savings-goal `+0.01` comparisons and obvious TL amount rounding sites with `money.ts` helpers.
- Faz C rounding/comparison audit closed: the non-money `Math.round` helpers (`fire`, `realValue`, `marketRates`, `goldLedger`) were classified as display/rate/quantity precision and commented in place; only ledger integer-kuruş conversion remains under Faz C.
- `CardsPage.sections.tsx` is now a thin nav/automation module; overview, statement/provision panels, and help copy live in focused `CardsPage.*` files.
- `CardsPage.tsx` data loading, account movement, statement payment, and section navigation orchestration now lives in `CardsPage.hooks.ts`.
- `CardsPage.tsx` CRUD form mapping, card metadata renderers, limit usage extra block, bank hue styling, grouping, and row action button now live in `CardsPage.crud.tsx`; the route file is mostly orchestration and modal wiring.
- `docs/SHARED_PAYMENT_DRAWER_PLAN.md` captures the shared payment drawer migration path across planned payments, card statement/manual debt payment, loan installments, and personal debt settlement.
- Shared payment drawer phase 1 is implemented: `PaymentsPage` now uses `useFinancePaymentDrawer` and `FinancePaymentDrawer`.
- Shared payment drawer phase 2 is implemented: `CardsPage` statement payment now uses the shared drawer.
- Shared payment drawer phase 3 is implemented: `LoansPage` loan installment payment now uses the shared drawer.
- Shared payment drawer phase 4 is implemented: `DebtsPage` personal debt settlement and receivable collection now use the shared drawer.
