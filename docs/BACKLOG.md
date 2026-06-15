# Priority Backlog

## P0 - High Confidence / High Value

- ~~Break large finance-heavy page files into smaller domain modules without changing behavior.~~ DONE.
  - All four candidates split: `CardsPage` (hooks/sections/crud), `LoansPage` (helpers/components), `AnalysisPage` (panels/atoms/reports/trends/wealth), `DataHealthPage` (logic/components/actions).
- ~~Finish Faz C money cleanup (ledger integer-kuruş conversion).~~ DONE.
  - `financeSummary.ts` fully migrated: `sum()` delegates to `sumTL`, all direct float additions use `sumTL([...])`, subtractions use `diffTL`, `clampCardBreakdown` operates in kuruş internally. No float TL arithmetic remains in the aggregation layer.
  - Rounding/comparison sweep was already done: all TL sums route through `roundTL`, and `+0.01` tolerances use `exceedsTL`/`moneyDiffers`. The remaining bare `Math.round(x*100)/100` sites (`fire`, `realValue`, `marketRates`, `goldLedger`) are intentionally NOT money (display/rate/quantity precision) and are commented as such — do not route them through `money.ts`.
  - Repo/service layers were already clean (no money arithmetic, only DB queries/RPCs).
- ~~Extract shared account movement helpers for account-backed RPCs.~~ DONE.
  - Bank debit/credit row locking, ownership checks, type checks, balance validation, and balance updates now live in internal `private.debit_bank_account` / `private.credit_bank_account` helpers.
  - User-facing RPCs keep their existing contracts and transaction-history writes; helpers are not exposed as public RPCs.
- Maintain the documented source of truth for card debt transitions in `docs/CARD_DEBT_TRANSITIONS.md`.
  - expense added
  - provision posted
  - statement cut
  - debt paid
- Continue banking simplification from `docs/BANKING_SIMPLIFICATION_AUDIT.md`.
  - ~~normalized upcoming obligations view~~ DONE for dashboard upcoming, analysis calendar, payment drawer intents, forecast buckets, and dashboard monthly load.

## P1 - Product / Reliability

- Reduce fallback logic that depends on missing Supabase schema cache or missing RPC deployment.
- Improve visibility of migration/version mismatches between frontend expectations and live database state.
- Document and standardize transaction history side effects for all finance mutations.
- Review whether recurring payments, loan installments, and card installments can be unified under a clearer planning model.

## P2 - UX / Maintainability

- ~~Add a concise developer-oriented architecture note for each major page.~~ DONE for DashboardPage, CardsPage, and DataHealthPage.
- Keep `docs/AI_CONTEXT_INDEX.md` current so future AI sessions can route to the right files with less repo scanning.
- ~~Reduce repeated split-total helper logic.~~ DONE.
  - Card debt split, scheduled installment, and unclassified debt classification now share `financeSummary.ts` helpers across Dashboard and Data Health.
- ~~Clarify where dashboard calculations belong versus page-local calculations.~~ DONE.
  - `docs/DASHBOARD_ARCHITECTURE.md` now has a Page-Local vs Shared Calculations decision table.
- ~~Audit Turkish copy and encoding consistency across UI strings and docs.~~ DONE.
  - 2026-06-15 guard run passed and a manual mojibake signature scan found no hits across 305 source/doc/migration files.

## P3 - Nice to Have

- Add guided import/restore flow for personal finance data. JSON/CSV export now exists in the data health screen.
- Add stronger historical analytics for cash flow and debt trend.
- Add better scenario planning around next-month and multi-month obligations.

## Suggested Next Tasks for Codex

1. ~~Reduce repeated split-total helper logic.~~ DONE.
2. Keep `docs/RPC_ACTION_REFERENCE.md` aligned when Supabase RPCs or user-visible actions change.
3. ~~Keep `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` aligned with release workflow changes.~~ DONE.
4. ~~Continue shrinking the remaining large route files.~~ DONE — all four large page files are now split into focused modules.

## Recently Cleared / No Longer First Next Task

- Targeted tests now exist for `cardStatement`, `budgetAlerts`, and savings goal progress.
- `financeSummary.test.ts` covers shared credit limit grouping, payable card debt excluding provision, and recurring payment month occurrence.
- A narrow Faz C pass replaced savings-goal `+0.01` comparisons and obvious TL amount rounding sites with `money.ts` helpers.
- Faz C rounding/comparison audit closed: the non-money `Math.round` helpers (`fire`, `realValue`, `marketRates`, `goldLedger`) were classified as display/rate/quantity precision and commented in place.
- Faz C integer-kuruş conversion completed: `financeSummary.ts` `sum()` now delegates to `sumTL`; all direct float TL additions/subtractions replaced with `sumTL`/`diffTL`; `clampCardBreakdown` operates in kuruş internally. Repo/service layers were already clean.
- Account-backed money RPCs now share internal bank-account debit/credit helpers while keeping public RPC contracts unchanged.
- Cash-flow forecast now derives payment/card/loan/debt buckets from the normalized `utils/obligations.ts` engine, including open statement archives when available.
- Legacy obligation cleanup pass completed: analysis month-close payment checks now consume the normalized obligation engine, and dashboard obligation mapping no longer exposes an unused public helper.
- `docs/DASHBOARD_ARCHITECTURE.md` now documents dashboard data flow, utility ownership, normalized obligation input, panel boundaries, and verification.
- Dashboard calculation ownership is now explicit: page-local glue stays in `DashboardPage`, finance/domain math moves to the documented utility owner.
- `docs/CARDS_ARCHITECTURE.md` and `docs/DATA_HEALTH_ARCHITECTURE.md` now document page module boundaries, side-effect ownership, and verification routes for the remaining high-risk pages.
- DataHealth copy polish pass completed for the older ASCII Turkish user-visible strings; encoding guard remains green.
- Turkish copy/encoding audit repeated on 2026-06-15: `encoding.guard.test.ts`, `docs.guard.test.ts`, and a manual mojibake signature scan were clean.
- Migration compatibility checklist now reflects the Lighthouse CI budget added to the release workflow.
- Missing Supabase schema/RPC detection now centralizes on `utils/supabaseErrors.ts`; page-local schema-cache wrapper aliases were removed.
- `roundMoney` alias was removed; money rounding/comparison helpers now live in `utils/money.ts`.
- Card debt split classification now shares `financeSummary.ts` helpers for Dashboard focus actions and Data Health issues.
- `CardsPage.sections.tsx` is now a thin nav/automation module; overview, statement/provision panels, and help copy live in focused `CardsPage.*` files.
- `CardsPage.tsx` data loading, account movement, statement payment, and section navigation orchestration now lives in `CardsPage.hooks.ts`.
- `CardsPage.tsx` CRUD form mapping, card metadata renderers, limit usage extra block, bank hue styling, grouping, and row action button now live in `CardsPage.crud.tsx`; the route file is mostly orchestration and modal wiring.
- `docs/SHARED_PAYMENT_DRAWER_PLAN.md` captures the shared payment drawer migration path across planned payments, card statement/manual debt payment, loan installments, and personal debt settlement.
- Shared payment drawer phase 1 is implemented: `PaymentsPage` now uses `useFinancePaymentDrawer` and `FinancePaymentDrawer`.
- Shared payment drawer phase 2 is implemented: `CardsPage` statement payment now uses the shared drawer.
- Shared payment drawer phase 3 is implemented: `LoansPage` loan installment payment now uses the shared drawer.
- Shared payment drawer phase 4 is implemented: `DebtsPage` personal debt settlement and receivable collection now use the shared drawer.
- All four large page files split into focused modules: `CardsPage` (hooks/sections/crud), `LoansPage` (helpers/components), `AnalysisPage` (panels/atoms/reports/trends/wealth), `DataHealthPage` (logic/components/actions). No file exceeds ~450 lines.
