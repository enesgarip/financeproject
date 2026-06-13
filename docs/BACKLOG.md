# Priority Backlog

## P0 - High Confidence / High Value

- Break large finance-heavy page files into smaller domain modules without changing behavior.
  - Highest candidates: `CardsPage.sections.tsx`, `DataHealthPage.tsx`, `CardsPage.tsx`
- Finish Faz C money cleanup.
  - Replace remaining ad hoc TL rounding/comparison points with `src/utils/money.ts` helpers.
  - Review legacy `roundMoney` and remaining non-obvious page/local rounding sites.
- Maintain the documented source of truth for card debt transitions in `docs/CARD_DEBT_TRANSITIONS.md`.
  - expense added
  - provision posted
  - statement cut
  - debt paid
- Continue banking simplification from `docs/BANKING_SIMPLIFICATION_AUDIT.md`.
  - shared account-payment drawer
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

1. Review remaining non-obvious rounding helpers (`fire`, `realValue`, `marketRates`) and decide whether they are money, display, or rate precision concerns.
2. Extract reusable card/account section helpers from `CardsPage.sections.tsx` before larger UI moves.
3. Plan the shared payment drawer across card debt, card installments, loan installments, planned payments, and personal debt settlement.
4. Keep `docs/RPC_ACTION_REFERENCE.md` aligned when Supabase RPCs or user-visible actions change.
5. Keep `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` aligned with release workflow changes.

## Recently Cleared / No Longer First Next Task

- Targeted tests now exist for `cardStatement`, `budgetAlerts`, and savings goal progress.
- `financeSummary.test.ts` covers shared credit limit grouping, payable card debt excluding provision, and recurring payment month occurrence.
- A narrow Faz C pass replaced savings-goal `+0.01` comparisons and obvious TL amount rounding sites with `money.ts` helpers.
