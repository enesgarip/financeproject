# Priority Backlog

## P0 - High Confidence / High Value

- ~~Break large finance-heavy page files into smaller domain modules without changing behavior.~~ DONE.
  - All four candidates split: `CardsPage` (hooks/sections/crud), `LoansPage` (helpers/components), `AnalysisPage` (panels/atoms/reports/trends/wealth), `DataHealthPage` (logic/components/actions).
  - `DataHealth.logic.ts` further split: guide/presentation → `DataHealth.guide.ts`, undo/export → `DataHealth.actions.ts`, core issue engine stays in `DataHealth.logic.ts`.
- ~~Finish Faz C money cleanup (ledger integer-kuruş conversion).~~ DONE.
  - `financeSummary.ts` fully migrated: `sum()` delegates to `sumTL`, all direct float additions use `sumTL([...])`, subtractions use `diffTL`, `clampCardBreakdown` operates in kuruş internally. No float TL arithmetic remains in the aggregation layer.
  - Rounding/comparison sweep was already done: all TL sums route through `roundTL`, and `+0.01` tolerances use `exceedsTL`/`moneyDiffers`. The remaining bare `Math.round(x*100)/100` sites (`fire`, `realValue`, `marketRates`, `goldLedger`) are intentionally NOT money (display/rate/quantity precision) and are commented as such — do not route them through `money.ts`.
  - Repo/service layers were already clean (no money arithmetic, only DB queries/RPCs).
- ~~Extract shared account movement helpers for account-backed RPCs.~~ DONE.
  - Bank debit/credit row locking, ownership checks, type checks, balance validation, and balance updates now live in internal `private.debit_bank_account` / `private.credit_bank_account` helpers.
  - User-facing RPCs keep their existing contracts and transaction-history writes; helpers are not exposed as public RPCs.
- ~~Maintain the documented source of truth for card debt transitions in `docs/CARD_DEBT_TRANSITIONS.md`.~~ DONE.
  - expense added
  - provision posted
  - statement cut
  - debt paid
  - 2026-06-15 review added credit-card funded `pay_payment`, ledger repair/correction, reset flow, and shared debt-breakdown helpers.
  - 2026-06-15 follow-up verified the transition matrix against `docs/RPC_ACTION_REFERENCE.md`, current card repositories/services, and latest card migrations; future behavior changes should update the source-of-truth doc in the same change.
- ~~Continue banking simplification from `docs/BANKING_SIMPLIFICATION_AUDIT.md`.~~ DONE.
  - ~~normalized upcoming obligations view~~ DONE for dashboard upcoming, analysis calendar, payment drawer intents, forecast buckets, and dashboard monthly load.
  - 2026-06-15 audit refresh moved the completed CardsPage module split out of remaining work and narrowed the open banking UX candidate to data-health maintenance polish.
  - 2026-06-15 data reset flow now takes an automatic JSON backup before calling the destructive reset RPC.
  - 2026-06-15 audit closeout moved the last notes into future-maintenance guidance; no P0 banking simplification candidate remains open.

## P1 - Product / Reliability

- ~~Reduce fallback logic that depends on missing Supabase schema cache or missing RPC deployment.~~ DONE.
  - Legacy `add_card_expense` retry against the retired 4-argument RPC signature was removed; the canonical RPC now surfaces missing-capability instead of silently falling back.
  - App-start finance maintenance no longer suppresses missing `post_due_card_auto_payments` / `cut_due_card_statements`; migration drift now surfaces through the shared missing-capability message.
  - Cards-page due statement automation now reports missing `cut_due_card_statements` deployment instead of silently skipping the cut.
  - Ledger and live-reconciliation panels now show shared migration-drift warnings instead of disappearing when optional tables are missing.
- ~~Improve visibility of migration/version mismatches between frontend expectations and live database state.~~ DONE.
  - Missing schema/RPC errors now share `missingSupabaseCapabilityMessage`, which calls out migration/RPC deployment drift and includes Supabase codes when available.
- ~~Document and standardize transaction history side effects for all finance mutations.~~ DONE.
  - `docs/TRANSACTION_HISTORY.md` now defines activity-feed role, type/source conventions, current RPC side effects, and no-history repair rules.
- ~~Review whether recurring payments, loan installments, and card installments can be unified under a clearer planning model.~~ DONE.
  - `docs/PLANNING_MODEL_REVIEW.md` keeps separate write tables, names `FinanceObligation` as the shared read-side projection, and lists the remaining low-risk cleanup.

## P2 - UX / Maintainability

- ~~Add a concise developer-oriented architecture note for each major page.~~ DONE for DashboardPage, CardsPage, and DataHealthPage.
- ~~Keep `docs/AI_CONTEXT_INDEX.md` current so future AI sessions can route to the right files with less repo scanning.~~ DONE.
  - 2026-06-15 context index reflects current route/module splits, DataHealth guide/action modules, dashboard component modules, backup utilities, data-health summary, and verification playbooks.
- ~~Reduce repeated split-total helper logic.~~ DONE.
  - Card debt split, scheduled installment, and unclassified debt classification now share `financeSummary.ts` helpers across Dashboard and Data Health.
- ~~Clarify where dashboard calculations belong versus page-local calculations.~~ DONE.
  - `docs/DASHBOARD_ARCHITECTURE.md` now has a Page-Local vs Shared Calculations decision table.
- ~~Audit Turkish copy and encoding consistency across UI strings and docs.~~ DONE.
  - 2026-06-15 guard run passed and a manual mojibake signature scan found no hits across 305 source/doc/migration files.

- ~~Add data health trust badge to dashboard.~~ DONE.
  - `utils/dataHealthSummary.ts` runs lightweight card-debt-split + loan-totals + limit checks from snapshot data.
  - `DataHealthBadge` component: green "temiz" or amber/red issue count with link to `/veri-sagligi`.

- ~~Split dashboard presentation panels into focused component modules.~~ DONE.
  - `DashboardPanels.tsx` now keeps hero/goal/metric/pulse pieces and shared panel types.
  - `DashboardCards.tsx`, `DashboardCashFlow.tsx`, and `DashboardInsights.tsx` own card/debt/history, cash-flow, and insight/action panels.

## P3 - Nice to Have

- Add guided import/restore flow for personal finance data.
  - JSON export/restore exists in Data Health, including a pre-restore safety backup.
  - CSV export exists; remaining import work is a guided CSV/manual mapping flow if that becomes useful.
- Add stronger historical analytics for cash flow and debt trend.
- Add better scenario planning around next-month and multi-month obligations.

## Suggested Next Tasks for Codex

1. ~~Reduce repeated split-total helper logic.~~ DONE.
2. Keep `docs/RPC_ACTION_REFERENCE.md` aligned when Supabase RPCs or user-visible actions change.
   - 2026-06-15 card payment, reset, and card-ledger repair/correction effects were refreshed after the card debt transition review.
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
- Transaction-history side effects are now standardized in `docs/TRANSACTION_HISTORY.md` and linked from the RPC/action reference.
- Planning model review completed: recurring payments, loan installments, card statements, card installments, and debt due dates should share `FinanceObligation` as a read-side projection rather than a new write table.
- Migration compatibility checklist now reflects the Lighthouse CI budget added to the release workflow.
- Missing Supabase schema/RPC detection now centralizes on `utils/supabaseErrors.ts`; page-local schema-cache wrapper aliases were removed.
- Missing schema/RPC user messages now use a shared deployment-mismatch helper with Supabase code visibility.
- Legacy `add_card_expense` RPC signature fallback was removed; missing canonical RPC deployment now follows the standard missing-capability path.
- Finance maintenance now reports missing scheduled-maintenance RPC deployment instead of silently skipping those app-start jobs.
- Cards-page due statement automation now surfaces missing statement-cut RPC deployment through the shared migration-drift message.
- Ledger and live-reconciliation panels now surface missing table deployment through the shared migration-drift message instead of silently hiding.
- `docs/CARD_DEBT_TRANSITIONS.md` now documents credit-card funded planned payments, card-ledger repair/correction flows, reset behavior, and the shared debt-breakdown helpers.
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
- `docs/BANKING_SIMPLIFICATION_AUDIT.md` now reflects the completed CardsPage module split and no longer lists it as remaining banking-simplification work.
- `docs/RPC_ACTION_REFERENCE.md` now mirrors the refreshed card debt transition source of truth for planned card-funded payments, card resets, and ledger repair/correction.
- Data Health "Tüm veriyi sil" now downloads a reset-before JSON backup before the destructive reset call and tells the user this preflight will happen.
- Data Health JSON backup restore already exists; the remaining P3 import work is narrowed to a guided CSV/manual mapping flow.
- Dashboard presentation panels were split into focused modules without changing dashboard data ownership or utility boundaries.
- P0/P2 closeout completed: card-debt source truth, banking audit, and AI context index are current as of 2026-06-15; future drift should be handled in the change that creates it.
- 2026-06-15 data-correctness audit started before P3: forward cash projections now respect non-cash card-installment obligations, Analysis forecast input carries open statement archives like Dashboard, and the Analysis 6-month chart title now says spending/load instead of true cash flow.
- The `pay_payment` shared drawer action no longer retries the retired two-argument RPC signature or updates payment amount client-side as a fallback; missing deployment now surfaces as a migration/RPC mismatch.
- 2026-06-15 follow-up data-correctness audit fixed the Analysis financial calendar day totals: calendar events now carry settlement/cash-impact metadata, and daily net totals use `cashImpactAmount` instead of raw card load. The same pass moved attention-line and planned-obligation daily totals onto `sumTL` instead of bare `reduce` additions.
- 2026-06-16 component data-correctness audit covered all page/component TSX files by risk bucket. Fixed shared search normalization for all-caps Turkish merchant/bank names, aligned card open-statement display/tone to one visible source, and moved the remaining component-facing TL totals/deltas onto `money.ts` helpers.
- 2026-06-16 remaining component audit notes closed: `LoansPage` undo reference was verified absent/build-green, finance snapshot maintenance is throttled/deduped, Analysis cash-flow trend uses the salary effective for each month, due statement automation has a run-key guard, and stale closure risks in quick-expense focus, toast timers, and Analysis async queries were removed.
