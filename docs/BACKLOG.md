# Priority Backlog

## P0 - High Confidence / High Value

- ~~Break large finance-heavy page files into smaller domain modules without changing behavior.~~ DONE.
  - All four candidates split: `CardsPage` (hooks/sections/crud), `LoansPage` (helpers/components), `AnalysisPage` (panels/atoms/reports/trends/wealth), `DataHealthPage` (logic/components/actions).
  - `DataHealth.logic.ts` further split: guide/presentation → `DataHealth.guide.ts`, undo/export → `DataHealth.actions.ts`, domain check functions → `DataHealth.checks.ts`; `DataHealth.logic.ts` is now a thin orchestrator (~160 lines) with types + `buildIssues` delegation.
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

- ~~Complete roadmap Y1 server-side Web Push sender.~~ DONE.
  - `push-notify` Supabase Edge Function sends VAPID-signed Web Push notifications for tomorrow's planned payments, tomorrow's loan installments, 3-day card statement cut reminders, and Monday weekly summaries.
  - `notification_log` prevents duplicate user/type/reference sends, and stale 404/410 endpoints are removed from `push_subscriptions`.
  - GitHub Actions invokes the sender daily at 04:00 UTC (07:00 Turkey time).
- Add Web Push v1.1 controls and observability.
  - Add a "test bildirimi gönder" action from the notification settings UI.
  - Let the user enable/disable payment, loan installment, statement cut, and weekly summary notifications separately.
  - Show last push run / last sent notification status in the settings card.
  - Add quiet-hours handling so scheduled notifications are not sent during user-defined silent hours.
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

- ~~Add DenizBank current movement PDF reconciliation.~~ DONE.
  - Cards page now opens a current movement import flow for DenizBank internet banking PDFs.
  - Pending rows import as provisions, posted spending imports as current-period expenses, payment rows are excluded, and installment rows are left for manual review.
  - Review now lists the detected period's app spending history, keeps matched bank/app pairs collapsed by default, and starts importable rows unselected for deliberate row-by-row import.
  - 2026-06-20 update: statement/current movement imports match still-open planned payments and use `pay_payment_from_card_import`, so card-paid bills do not remain as duplicate pending obligations after import.
  - 2026-06-20 follow-up: import review selection now uses stable per-row keys, so identical-looking rows can be selected one by one; Data Health also flags exact/possible duplicate card expenses using transaction fingerprints.
  - 2026-06-20 v2: Mutabakat ekranı conflict-resolution tarzına dönüştürüldü — eşleşen/sadece bankada/sadece app'te kategorileri yan yana gösterilir, app-only harcamalar direkt iptal edilebilir (`cancel_card_expense` RPC). Mobil tarayıcılarda PDF import devre dışı.
- Add "kasa modu" / spendable balance planning.
  - Let bank balances be mentally allocated into buckets such as emergency fund, taxes/insurance, vacation, investment, and spendable cash.
  - Keep the underlying bank balance unchanged; this is a planning overlay, not a ledger movement.
  - Surface "harcanabilir bakiye" on Dashboard so the user sees what is safe to spend after reserved buckets.
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
  - `utils/dataHealthSummary.ts` runs lightweight card-debt-split/scheduled-debt + loan-totals + limit checks from snapshot data.
  - `DataHealthBadge` component: green "temiz" or amber/red issue count with link to `/veri-sagligi`.

- ~~Split dashboard presentation panels into focused component modules.~~ DONE.
  - `DashboardPanels.tsx` now keeps hero/goal/metric/pulse pieces and shared panel types.
  - `DashboardCards.tsx`, `DashboardCashFlow.tsx`, and `DashboardInsights.tsx` own card/debt/history, cash-flow, and insight/action panels.

## P2 - UX / Maintainability (yeni fikirler)

- ~~Add monthly financial summary report ("Aylık Finansal Özet").~~ DONE.
  - `utils/monthlySummary.ts` + MonthlyReport paneli kategori dağılımı, ay-ay değişim, paylaşılabilir kart.
- ~~Add full-month financial calendar view ("Nakit Akış Takvimi — tam ay görünümü").~~ DONE.
  - `utils/fullMonthCalendar.ts` + `AnalysisPage.calendar.tsx`: 7 sütun takvim grid, renk kodlu günler, gün detayı, haftalık net akış, bakiye projeksiyonu.
- ~~Add financial milestones and achievements ("Finansal Başarımlar").~~ DONE.
  - `utils/milestones.ts` + MilestonesPanel: nakit eşikleri, sıfır borç, tamamlanan hedefler, net değer ATH, 3-ay düşüş serisi, sağlıklı kredi kullanımı.
- ~~Add weekly mini report via push ("Haftalık Mini Rapor").~~ DONE.
  - `push-notify/index.ts` haftalık özeti zenginleştirildi: harcama toplamı, hafta-hafta değişim %, en büyük kategori.
- ~~Add comparative period analysis ("Karşılaştırmalı Dönem Analizi").~~ DONE.
  - `utils/periodComparison.ts` + PeriodComparisonPanel: ay/çeyrek/yıl modları, kategori bazlı karşılaştırma grid.
- ~~Add subscription/fixed expense management ("Abonelik & Sabit Gider Yönetimi").~~ DONE.
  - `utils/subscriptions.ts` + SubscriptionsPanel: tekrarlayan harcama tespiti, aylık toplam, gelire oran.
- ~~Add shareable financial summary card ("Paylaşılabilir Finansal Özet Kartı").~~ DONE.
  - `utils/shareableCard.ts` + MonthlyReport "Kart" butonu: Canvas 2x retina dark-theme PNG indirme.
- ~~Add quiet day analysis ("Sessiz Gün Analizi").~~ DONE.
  - `utils/quietDays.ts` + QuietDaysPanel: sessiz gün sayısı, mevcut seri, en iyi seri, aktif gün ortalama harcaması.
- ~~Add year-end financial report ("Yıl Sonu Finansal Rapor").~~ DONE.
  - `utils/yearEndReport.ts` + YearEndReport paneli: yıllık harcama, aylık bar chart, en pahalı/ucuz ay, top kategoriler, net değer değişimi.

## P3 - Nice to Have

- Add goal-based automatic saving suggestions.
  - For each active savings goal, show the monthly amount needed to hit the target date.
  - Adjust suggestions against upcoming obligations so the app can say "bu ay hedefe ara ver" or "bu ay fazladan X ₺ ayırabilirsin."
  - Reuse existing savings goals and cash-flow/obligation projections before adding any new write model.
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

- 2026-06-18 Lighthouse CI now maps the GitHub Actions token to `LHCI_GITHUB_TOKEN` with job-scoped status permission, so LHCI can publish GitHub status without an extra PAT while still uploading `.lighthouseci` reports as artifacts.
- 2026-06-18 Lighthouse CI target changed to `/login`; Chrome flags, throttling mode, and FCP/load waits were hardened after GitHub runner logs showed `NO_FCP` on the unauthenticated route audit.
- 2026-06-18 Lighthouse CI now serves the built app through `npm run preview` on `127.0.0.1:4173` instead of LHCI's random-port static server, aligning it with the Playwright smoke-test network pattern after repeated GitHub runner `NO_FCP` failures.
- 2026-06-18 Lighthouse CI now runs inside the Playwright Chromium container and exports `CHROME_PATH` from Playwright, avoiding drift from GitHub runner's system Chrome channel after repeated `HeadlessChrome/149` `NO_FCP` failures.
- 2026-06-18 added loan-affordability decision support under `Analiz > Servet`: `utils/loanAffordability.ts` estimates safe monthly installment, maximum principal, a balanced recommended scenario, selected-loan payment, stress balance, and a suitable/caution/not-recommended verdict from salary, current load, cash buffer, and forward cash projection.
- 2026-06-18 UX information architecture pass split the longest scroll surfaces into hubs: Analysis now has Genel/Trendler/Servet/Kayıtlar routes, Data Health separates Bulgular from Yedek & Ayarlar, and the bottom navigation labels now read Özet/Hesaplar/Birikim/Borçlar/Takvim.
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
- 2026-06-17 all 9 known risks mitigated: card debt math (#4) documented with trigger/test safeguards, mixed loan model (#5) documented as intentional labeled fallback, DataHealth operational power (#6) documented undo/backup/test layers, test coverage (#7) closed with `cardInstallmentCalendar.test.ts` (all aggregation utils now tested), credit limit semantics (#8) code-commented and tested.
- 2026-06-16 remaining component audit notes closed: `LoansPage` undo reference was verified absent/build-green, finance snapshot maintenance is throttled/deduped, Analysis cash-flow trend uses the salary effective for each month, due statement automation has a run-key guard, and stale closure risks in quick-expense focus, toast timers, and Analysis async queries were removed.
- 2026-06-16 salary cash-flow semantics clarified: monthly summaries and forward forecasts use the salary effective for each target month, and Dashboard exposes salary as a separate income line.
