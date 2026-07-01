# AI Context Index

Last reviewed: 2026-06-22

This file is the cheapest starting point for future AI/Codex sessions. Its job
is to reduce repeated repo discovery: read this first, choose the smallest
relevant route, then open only the linked source files and docs for the task.

## Cost Rule

Do not start by reading every page, migration, or test file. Start with:

1. The user's exact request.
2. This index.
3. One source-of-truth doc for the affected domain.
4. The target code file and its closest test.

Expand only when the change crosses a boundary such as page -> utility,
frontend -> RPC, or RPC -> migration.

## Permanent Context

| File | Read When | Owns |
| --- | --- | --- |
| `CLAUDE.md` | A new AI agent needs persistent repo rules before acting | Stack summary, layer boundaries, money-model warnings, deployment gotchas |
| `docs/CODEX_GUIDE.md` | A Codex session needs working rules and finish checklist | How to work in this repo with low regression risk |
| `docs/PROJECT_CONTEXT.md` | You need the product map or route/table overview | Product purpose, app structure, important domains, route model |
| `docs/DASHBOARD_ARCHITECTURE.md` | You are changing `/` dashboard orchestration, dashboard-specific derived math, or dashboard UX/a11y behavior | Dashboard data flow, utility ownership, obligation input, panel boundaries, UX/a11y contract |
| `docs/CARDS_ARCHITECTURE.md` | You are changing `/kartlar` orchestration, card/account panels, or card page module boundaries | Cards page data flow, module map, side-effect boundaries, payment flow |
| `docs/DATA_HEALTH_ARCHITECTURE.md` | You are changing `/veri-sagligi`, data-health checks, safe fixes, undo, backup, or reset flows | Data-health lifecycle, issue/fix ownership, write safety, invariant sources |
| `docs/KNOWN_RISKS.md` | You are choosing risk level or reviewing a change | Known failure modes and where to be extra cautious |
| `docs/BACKLOG.md` | You need the next useful task | Priority backlog, 6-geçiş denetim sentezi (2026-06-23), suggested Codex tasks |

## Domain Source Of Truth

| Domain | First Doc | Then Read | Notes |
| --- | --- | --- | --- |
| Card debt fields and transitions | `docs/CARD_DEBT_TRANSITIONS.md` | `src/utils/financeSummary.ts`, `src/pages/CardsPage*.tsx`, latest card migrations | Use this before touching `debt_amount`, `statement_debt_amount`, `current_period_spending`, `provision_amount`, or card installments |
| General finance rules | `docs/FINANCE_RULES.md` | Matching utility under `src/utils/*` | Broad business semantics: assets, cards, payments, loans, debts, goals, dashboard |
| RPC-backed actions | `docs/RPC_ACTION_REFERENCE.md` | `src/data/repositories/*`, `src/services/*`, `src/types/database.ts`, migrations | Maps Supabase RPCs to user-visible actions and side effects |
| Transaction history side effects | `docs/TRANSACTION_HISTORY.md` | `docs/RPC_ACTION_REFERENCE.md`, latest finance RPC migrations, dashboard/analysis history consumers | Type/source/amount conventions for user-facing activity feed rows |
| Shared payment drawer | `docs/SHARED_PAYMENT_DRAWER_PLAN.md` | `src/hooks/useFinancePaymentDrawer.ts`, `src/components/finance/FinancePaymentDrawer.tsx`, `src/components/finance/AccountPaymentModal.tsx`, `src/services/financePaymentActions.ts`, payment-owning pages | Plan and shared implementation for account-backed payment modals without changing RPC behavior |
| Release/migration compatibility | `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` | `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `supabase/migrations/*` | Use for schema, RLS, RPC, edge function, or generated type changes |
| Banking simplification | `docs/BANKING_SIMPLIFICATION_AUDIT.md` | `src/pages/CardsPage*.tsx`, `src/components/finance/*`, `docs/CARDS_ARCHITECTURE.md` | Tracks completed banking simplifications and future maintenance notes |
| Pipeline/deploy | `docs/PIPELINE.md` | GitHub workflow files, `.lighthouserc.cjs`, and package scripts | CI, deploy, secrets, branch flow |

## Architecture Map

| Layer | Path | Rule |
| --- | --- | --- |
| Domain utilities | `src/utils/*` | Pure calculations and business rules. Prefer tests here. No Supabase imports. |
| Data repositories | `src/data/repositories/*` | Table reads/writes and repository-shaped Supabase access. Return `Result<T>`. |
| Services | `src/services/*` | RPC wrappers and cross-table mutation actions. Direct Supabase calls are intentional here. |
| App hooks | `src/app/*` | TanStack Query cache and use-case hooks. |
| Pages | `src/pages/*` | Route-level orchestration and UI state. Avoid burying new domain math here. |
| Components | `src/components/*` | Reusable UI, finance panels, charts (saf SVG: DonutChart, BarChart, CashFlowChart, LineChart + chartUtils), selectors, modals. |
| Database | `supabase/migrations/*` | Schema, RLS, triggers, RPCs. Treat migrations as forward-only after production. |
| Edge functions | `supabase/functions/*` | External parsing/quote/push services. Use `_shared/edge.ts` conventions. |

ESLint blocks `src/{pages,components,utils,hooks}` from importing
`src/lib/supabase`. If UI needs data, add or reuse a repository/service wrapper.

## Feature Routes

| Route | Main Files | Data/Utility Neighbors |
| --- | --- | --- |
| `/` dashboard | `docs/DASHBOARD_ARCHITECTURE.md`, `src/pages/DashboardPage.tsx`, `src/components/dashboard/*` | `src/app/useFinanceSnapshot.ts`, `src/data/repositories/financeSnapshotRepo.ts`, `src/utils/dashboard*`, `src/utils/financeSummary.ts`, `src/utils/obligations.ts` |
| `/kartlar` accounts/cards | `docs/CARDS_ARCHITECTURE.md`, `src/pages/CardsPage.tsx`, `src/pages/CardsPage.hooks.ts`, `src/pages/CardsPage.crud.tsx`, `src/pages/CardsPage.sections.tsx`, `src/pages/CardsPage.overview.tsx`, `src/pages/CardsPage.statements.tsx`, `src/pages/CardsPage.expense.tsx`, `src/pages/CardsPage.list.tsx`, `src/pages/CardsPage.installment.tsx`, `src/pages/CardsPage.helpers.ts`, `src/hooks/useBalancePrivacy.ts` | `src/data/repositories/cardsRepo.ts`, `src/data/repositories/cardAliasesRepo.ts`, `src/data/repositories/financePanelsRepo.ts`, `src/services/accountMovements.ts`, `src/utils/accountLedger.ts`, `src/utils/cardStatement.ts`, `src/utils/financeSummary.ts` |
| `/odemeler` planned payments | `src/pages/PlanningHub.tsx`, `src/pages/PaymentsPage.tsx` | `src/data/repositories/paymentsRepo.ts`, `src/services/financePaymentActions.ts`, `src/utils/obligations.ts`, `docs/PLANNING_MODEL_REVIEW.md`, `docs/SHARED_PAYMENT_DRAWER_PLAN.md` |
| `/borclar/krediler` loans | `src/pages/LoansPage.tsx`, `src/pages/LoansPage.helpers.ts`, `src/pages/LoansPage.components.tsx` | `src/data/repositories/loansRepo.ts`, `src/services/financePaymentActions.ts`, `src/utils/financeSummary.ts`, `docs/SHARED_PAYMENT_DRAWER_PLAN.md` |
| `/borclar/kisiler` personal debts | `src/pages/DebtsPage.tsx` | `src/data/repositories/debtsRepo.ts`, `src/services/financePaymentActions.ts`, `docs/SHARED_PAYMENT_DRAWER_PLAN.md` |
| `/varliklar` assets | `src/pages/AssetsPage.tsx`, `src/pages/AssetsHub.tsx` | `src/data/repositories/valuationRepo.ts`, `src/utils/valuation*`, `src/utils/marketRates.ts` |
| `/varliklar/maas` salary | `src/pages/SalaryPage.tsx` | `src/utils/financeSummary.ts` salary helpers |
| `/analiz` reports hub | `src/pages/AnalysisHub.tsx`, `src/pages/AnalysisPage.tsx`, `src/pages/AnalysisDetailPage.tsx`, `src/pages/AnalysisPage.data.ts`, `src/pages/AnalysisPage.loan.tsx`, `src/pages/AnalysisPage.panels.tsx`, `src/pages/AnalysisPage.reports.tsx`, `src/pages/AnalysisPage.trends.tsx`, `src/pages/AnalysisPage.wealth.tsx`, `src/pages/AnalysisPage.calendar.tsx` | `src/app/useFinanceSnapshot.ts`, `src/data/repositories/analysisRepo.ts`, `src/utils/analysisView.ts`, `src/utils/loanAffordability.ts`, charts |
| `/veri-sagligi` data health hub | `docs/DATA_HEALTH_ARCHITECTURE.md`, `src/pages/DataHealthHub.tsx`, `src/pages/DataHealthPage.tsx`, `src/pages/DataHealthOperationsPage.tsx`, `src/pages/DataHealthPage.actions.ts`, `src/pages/DataHealth.logic.ts`, `src/pages/DataHealth.checks.ts`, `src/pages/DataHealth.guide.ts`, `src/pages/DataHealth.actions.ts` | `src/data/repositories/dataHealthRepo.ts`, `src/hooks/useFinancePaymentDrawer.ts`, ledger utilities, finance invariants |
| `/login` auth | `src/pages/LoginPage.tsx`, `src/auth/*` | `src/lib/supabase.ts` |

## Source-Of-Truth Matrix

| Question | Source |
| --- | --- |
| How is card debt supposed to move? | `docs/CARD_DEBT_TRANSITIONS.md` |
| Which user action calls which RPC? | `docs/RPC_ACTION_REFERENCE.md` |
| Which finance action writes transaction history? | `docs/TRANSACTION_HISTORY.md` |
| Is this migration safe to release? | `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` |
| Where does dashboard data come from? | `src/app/useFinanceSnapshot.ts` and `src/data/repositories/financeSnapshotRepo.ts` |
| Where should dashboard calculations live? | `docs/DASHBOARD_ARCHITECTURE.md`; start with its Page-Local vs Shared Calculations table |
| How should dashboard loading/error/empty/chart states behave? | `docs/DASHBOARD_ARCHITECTURE.md`; see its UX And Accessibility Contract |
| How should money be rounded/compared? | `src/utils/money.ts`; avoid new ad hoc tolerances |
| How should search text be normalized? | `src/utils/searchText.ts`; use it instead of `toLocaleLowerCase('tr-TR')` for matching/filtering |
| How are shared credit limits grouped? | `buildCreditLimitGroups` in `src/utils/financeSummary.ts` |
| How is loan summary projected? | `projectLoanSummary` in `src/utils/financeSummary.ts` plus DB trigger `sync_loan_summary` |
| How are card/account ledgers projected? | `src/utils/cardLedger.ts`, `src/utils/accountLedger.ts` |
| How are monthly obligations built? | `src/utils/obligations.ts`; see `docs/PLANNING_MODEL_REVIEW.md` for why this stays a read-side projection instead of one write table |
| How is new-loan affordability estimated? | `src/utils/loanAffordability.ts`; safe installment, balanced recommendation, decision support only, not bank approval |
| How are Turkish calendar presets defined? | `src/utils/obligationPresets.ts`, `src/components/finance/TurkishCalendarPresets.tsx` |

## Common Task Playbooks

### Card Debt Or Card Page Change

Read:

1. `docs/CARD_DEBT_TRANSITIONS.md`
2. `docs/CARDS_ARCHITECTURE.md`
3. `src/utils/financeSummary.ts`
4. `src/pages/CardsPage.helpers.ts`
5. The relevant `CardsPage.*.tsx` presentation module (`crud`, `sections`, `overview`, `statements`, `expense`, `list`, or `installment`)
6. Latest card-related migrations if RPC behavior changes

Verify:

- `npm exec -- vitest run src/utils/financeSummary.test.ts`
- `npm run test:unit`
- `npm run lint`
- `npm run build`

### New Or Changed RPC

Read:

1. `docs/RPC_ACTION_REFERENCE.md`
2. `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md`
3. `src/types/database.ts`
4. The repository/service wrapper that will call it
5. The migration that defines it

Update:

- RPC args/return type in `src/types/database.ts`
- Repository/service wrapper
- Business-rule docs if side effects changed
- Grants in the final migration signature

### Page Refactor

Read:

1. Target page
2. `docs/KNOWN_RISKS.md`
3. The nearest utilities/repositories
4. Existing tests for utilities touched by the page

Keep behavior stable. Extract pure calculations to `src/utils/*` when possible,
then cover with focused unit tests. Do not add a new abstraction unless it
removes real duplication or isolates domain behavior.

### Data Health Change

Read:

1. `src/pages/DataHealth.logic.ts` (types + thin orchestrator)
2. `src/pages/DataHealth.checks.ts` (domain check functions)
3. `docs/DATA_HEALTH_ARCHITECTURE.md`
4. `src/pages/DataHealth.logic.test.ts`
5. `docs/KNOWN_RISKS.md`
6. `src/pages/DataHealth.guide.ts` for issue copy/presentation
7. `src/pages/DataHealth.actions.ts` for undo/export helpers
8. Relevant invariant helper in `src/utils/*`

Treat data-health fixes as operational writes against real user data. Prefer a
shared helper/DB invariant over a page-only corrective formula.

### Migration Or Release Change

Read:

1. `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md`
2. `docs/PIPELINE.md`
3. `.github/workflows/ci.yml`
4. `.github/workflows/deploy.yml`
5. `.lighthouserc.cjs` when changing Lighthouse collection/assertion behavior

Use local Supabase checks when available. Production deploy order is migration
and edge functions first, Vercel deploy hook second.

## Verification Ladder

Choose the smallest ladder that matches the risk:

| Risk | Commands |
| --- | --- |
| Docs-only | `git diff --check` |
| Pure utility change | Targeted Vitest file, then `npm run test:unit` |
| TypeScript/UI change | `npm run lint`, `npm run test:unit`, `npm run build` |
| Route/user-flow change | Previous row plus `npm run test:e2e` when feasible |
| Migration/RPC/RLS change | Previous row plus `npm run db:reset:local`, `npm run db:lint:local`, `npm run db:audit:rls:local` when local Supabase is available |
| Release-critical change | `npm run ci:local` and CI green |

## Cost-Saving Status

The original cost-saving work is complete as of 2026-06-15:

- architecture notes exist for `DashboardPage`, `CardsPage`, and
  `DataHealthPage`
- dashboard calculation ownership is documented in
  `docs/DASHBOARD_ARCHITECTURE.md`
- route/component maps include the current Dashboard and DataHealth splits

Going forward, keep docs current in the same change that moves behavior,
modules, routes, repositories, or RPC contracts. Stale docs increase AI cost
more than no docs.

## Konu → Dosya (hızlı Türkçe tablo)

Bir işe başlarken keşif turu (grep fan-out) atmamak için: "şu konuya dokunacaksan
önce şu dosyalara bak." Bağlayıcı değil, başlangıç noktasıdır. (`docs.guard.test.ts`
her repository + route sayfasının bu tabloda adıyla geçmesini CI'da zorlar.)

Paylaşılan veri: `src/app/useFinanceSnapshot.ts` (Dashboard + Analysis aynı cache'i
paylaşır; her sayfa süpersetini client-side daraltır). Query client: `src/app/queryClient.ts`.

| İş / konu | Önce bak (domain/util) | Veri katmanı | UI |
|---|---|---|---|
| **Para hesabı/yuvarlama** | `utils/money.ts` (+ `money.test.ts`, `money.property.test.ts`) | — | — |
| **Arama / metin normalizasyonu** | `utils/searchText.ts`, `utils/categories.ts`, `utils/bankBranding.ts` | — | `components/CrudPage.tsx`, `components/QuickActions.tsx`, `components/dashboard/DashboardCards.tsx`, `pages/AnalysisPage.reports.tsx` |
| **Kart borcu / breakdown** | `utils/cardLedger.ts`, `utils/financeSummary.ts` (`clampCardBreakdown`) | `data/repositories/cardsRepo.ts`, `services/cardLedgerActions.ts` | `pages/CardsPage.tsx` (+ `.crud.tsx`, `.helpers.ts`, `.sections.tsx`, `.overview.tsx`, `.statements.tsx`, `.list.tsx`) |
| **Ekstre / statement döngüsü** | `utils/cardStatement.ts`, `utils/statementCycle.ts`, `utils/statementReminder.ts`, `utils/importReviewPeriod.ts`, `utils/denizBankStatementParser.ts` (+ `.test.ts`), `utils/transactionFingerprint.ts` | `data/repositories/cardsRepo.ts` (`fetchCardExpenseMatchRows`, `fetchCardPaymentMatchRows`, `addCardExpense`, `payPaymentFromCardImport`) | `components/finance/StatementImportModal.tsx`, `pages/CardsPage.tsx` |
| **DenizBank güncel hareket mutabakatı** | `utils/denizBankMovementParser.ts` (+ `.test.ts`), `utils/importReviewPeriod.ts`, `utils/transactionFingerprint.ts` | `data/repositories/cardsRepo.ts` (`fetchCardExpenseMatchRows`, `fetchCardPaymentMatchRows`, `addCardExpense`, `payPaymentFromCardImport`, `cancelCardExpense`) | `components/finance/CurrentMovementImportModal.tsx`, `pages/CardsPage.tsx`, `pages/CardsPage.list.tsx` |
| **Taksit takvimi** | `utils/cardInstallmentCalendar.ts` | `data/repositories/cardsRepo.ts` (`addCardExpense`, `recordCardInstallmentCarryover`) | `pages/CardsPage.tsx`, `pages/CardsPage.expense.tsx` |
| **Banka bakiyesi / hareket / mutabakat** | `utils/accountLedger.ts`, `utils/reconciliation.ts` | `data/repositories/financePanelsRepo.ts`, `services/accountLedgerActions.ts`, `services/accountMovements.ts` | `pages/CardsPage.tsx`, `pages/CardsPage.list.tsx`, `components/finance/AccountLedgerPanel.tsx` |
| **Klasik banka/kart UX (IBAN, maskeleme, son hareketler, bakiye gizleme)** | `utils/accountLedger.ts`, `hooks/useBalancePrivacy.ts`, `pages/CardsPage.helpers.ts` | `data/repositories/cardAliasesRepo.ts`, `data/repositories/financePanelsRepo.ts` | `pages/CardsPage.tsx`, `pages/CardsPage.list.tsx`, `pages/CardsPage.crud.tsx`, `components/finance/FinancePaymentDrawer.tsx` |
| **Kredi & taksitleri** | `utils/financeSummary.ts` (`projectLoanSummary`) | `data/repositories/loansRepo.ts` | `pages/LoansPage.tsx` |
| **Yeni kredi uygunluğu** | `utils/loanAffordability.ts` (+ `loanAffordability.test.ts`) | `financeSnapshotRepo.ts` | `pages/AnalysisDetailPage.tsx`, `pages/AnalysisPage.loan.tsx` |
| **Kişisel borç/alacak** | `utils/obligations.ts`, `utils/obligationPresets.ts` | `data/repositories/debtsRepo.ts` | `pages/DebtsPage.tsx`, `LiabilitiesHub.tsx` |
| **Planlı ödemeler** | `utils/dashboardUpcoming.ts`, `utils/attention.ts`, `utils/financeObligationRules.ts` | `data/repositories/paymentsRepo.ts`, `services/financePaymentActions.ts` | `pages/PaymentsPage.tsx` |
| **Varlıklar / değerleme** | `utils/valuation.ts`, `utils/valuationSync.ts`, `utils/realValue.ts` | `data/repositories/valuationRepo.ts`, `analysisRepo.ts` | `pages/AssetsPage.tsx`, `AssetsHub.tsx` |
| **Altın (gram/ledger)** | `utils/goldLedger.ts`, `utils/goldLedgerSync.ts`, `utils/zakat.ts` | `data/repositories/goldLedgerRepo.ts` | `pages/GoldPage.tsx` |
| **Maaş geçmişi** | `utils/lastUsed.ts` | `data/repositories/crudRepo.ts` | `pages/SalaryPage.tsx` |
| **Birikim hedefleri** | `utils/savingsGoal.ts` | `data/repositories/savingsGoalsRepo.ts` | (Assets/Dashboard) |
| **Bütçe uyarıları** | `utils/budgetAlerts.ts` | `data/repositories/crudRepo.ts` | `pages/CardsPage.tsx` |
| **Dashboard özet/insight** | `utils/dashboardInsights.ts`, `utils/cashFlowForecast.ts`, `utils/dashboardUpcoming.ts`, `utils/obligations.ts`, `utils/financeObligationRules.ts`, `utils/netWorthSeries.ts`, `utils/dataHealthSummary.ts` | `data/repositories/financeSnapshotRepo.ts` | `pages/DashboardPage.tsx` |
| **Analiz / raporlar** | `utils/analysisView.ts`, `utils/spendingAnomalies.ts`, `utils/priceIncreaseRadar.ts` | `data/repositories/analysisRepo.ts` | `pages/AnalysisHub.tsx`, `pages/AnalysisPage.tsx`, `pages/AnalysisDetailPage.tsx` |
| **Aktivite akışı (audit trail)** | `utils/activityFeed.ts` | `data/repositories/financePanelsRepo.ts` | `pages/AnalysisPage.activity.tsx` (ActivityFeedPanel) |
| **Kart tutarlılık skoru** | `utils/cardConsistency.ts` (+ test) | — | `pages/CardsPage.list.tsx` (skor badge) |
| **Bütçe & birikim hedefleri (planlama)** | `utils/savingsGoal.ts`, `utils/budgetAlerts.ts` | `data/repositories/savingsGoalsRepo.ts` | `pages/PlanningHub.tsx`, `pages/PlanningPage.tsx`, `components/finance/SavingsGoalsPanel.tsx` |
| **Finansal rapor (PDF/AI paylaşım)** | `utils/financialReport.ts` | — | `pages/AnalysisDetailPage.tsx`, `pages/AnalysisPage.reports.tsx` |
| **Sessiz gün analizi** | `utils/quietDays.ts` | — | `pages/AnalysisPage.panels.tsx` (QuietDaysPanel) |
| **Aylık özet / kategori dağılımı** | `utils/monthlySummary.ts` | — | `pages/AnalysisPage.reports.tsx` (MonthlyReport) |
| **Nakit akış takvimi (tam ay)** | `utils/fullMonthCalendar.ts` | — | `pages/AnalysisPage.calendar.tsx` (FullMonthCalendarPanel) |
| **Finansal başarımlar (milestone)** | `utils/milestones.ts` | — | `pages/AnalysisPage.panels.tsx` (MilestonesPanel) |
| **Karşılaştırmalı dönem analizi** | `utils/periodComparison.ts` | — | `pages/AnalysisPage.panels.tsx` (PeriodComparisonPanel) |
| **Abonelik / sabit gider yönetimi** | `utils/subscriptions.ts` | — | `pages/AnalysisPage.panels.tsx` (SubscriptionsPanel) |
| **Paylaşılabilir özet kartı** | `utils/shareableCard.ts` | — | `pages/AnalysisPage.reports.tsx` (MonthlyReport "Kart" butonu) |
| **Yıl sonu finansal rapor** | `utils/yearEndReport.ts` | — | `pages/AnalysisPage.reports.tsx` (YearEndReport) |
| **Forecast / senaryo / FIRE / enflasyon** | `utils/cashFlowForecast.ts`, `utils/scenarioForecast.ts`, `utils/financeObligationRules.ts`, `utils/fire.ts`, `utils/inflationShield.ts`, `utils/loanAffordability.ts` | `financeSnapshotRepo.ts` | `pages/DashboardPage.tsx`, `pages/AnalysisPage.tsx`, `pages/AnalysisDetailPage.tsx` |
| **Veri sağlığı / onarım** | `pages/DataHealth.logic.ts` (types + orchestrator), `pages/DataHealth.checks.ts` (domain checks), `utils/financeSummary.ts` (trigger TS ikizleri), `utils/transactionFingerprint.ts` (kart harcaması duplicate/fingerprint) | `data/repositories/dataHealthRepo.ts` | `pages/DataHealthHub.tsx`, `pages/DataHealthPage.tsx`, `pages/DataHealthOperationsPage.tsx` |
| **Kategori eşleme (tr-TR tuzağı)** | `utils/categories.ts` (`normalizeDescription`) | `data/repositories/categoryMemoryRepo.ts` | — |
| **Yedek / backup** | `utils/backup.ts` | `data/repositories/backupRepo.ts` | (DataHealth) |
| **Push bildirim** | — | `data/repositories/pushSubscriptionsRepo.ts`, `services/pushNotifications.ts`, `supabase/migrations/20260617102826_add_notification_log.sql`, `.github/workflows/push-notify.yml` | `supabase/functions/push-notify`, `public/sw.js`, `components/finance/NotificationSettings.tsx` |
| **SMS harcama otomasyonu** | `utils/categories.ts` (inferExpenseCategory) | `data/repositories/cardAliasesRepo.ts`, `data/repositories/smsLogRepo.ts`, `supabase/migrations/20260626120000_add_sms_log.sql`, `supabase/migrations/20260702120000_tolerant_sms_account_matching.sql` (hesap no toleranslı eşleşme) | `supabase/functions/parse-sms`, `components/finance/CardAliasPanel.tsx`, `components/finance/SmsLogPanel.tsx` (`/veri-sagligi/islemler`) |
| **Piyasa kuru / BIST** | `utils/marketRates.ts` | — | `supabase/functions/bist-quote` |
| **Şema / tip / RPC kontratı** | — | `src/types/database.ts` | — |
| **Migration / trigger** | `utils/financeSummary.ts` (saf TS ikizleri) | `supabase/migrations/*` | — |

Sık dokunulan, UI+iş kuralı karışık dosyalar: `DashboardPage.tsx`, `CardsPage.tsx`,
`DataHealthPage.tsx`, `financeSummary.ts` — değişiklikte dashboard + veri sağlığı
yan etkisini kontrol et.
