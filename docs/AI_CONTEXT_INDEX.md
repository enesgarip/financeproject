# AI Context Index

Last reviewed: 2026-08-12

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
| `docs/UI_ARCHITECTURE.md` | You are changing shared visual language, route shells, navigation, page hierarchy, or UI primitives | Şerit görsel sözleşmesi (kartsız dil, kabuk, token'lar), shared templates, route patterns, responsive/a11y contract |
| `docs/DASHBOARD_ARCHITECTURE.md` | You are changing `/` dashboard orchestration, dashboard-specific derived math, or dashboard UX/a11y behavior | Dashboard data flow, utility ownership, obligation input, panel boundaries, UX/a11y contract |
| `docs/CARDS_ARCHITECTURE.md` | You are changing `/kartlar` orchestration, card/account panels, or card page module boundaries | Cards page data flow, module map, side-effect boundaries, payment flow |
| `docs/DATA_HEALTH_ARCHITECTURE.md` | You are changing `/veri-sagligi`, data-health checks, safe fixes, undo, backup, or reset flows | Data-health lifecycle, issue/fix ownership, write safety, invariant sources |
| `docs/KNOWN_RISKS.md` | You are choosing risk level or reviewing a change | Known failure modes and where to be extra cautious |
| `docs/BACKLOG.md` | You need the next useful task | Priority backlog, 6-geçiş denetim sentezi (2026-06-23), suggested Codex tasks |
| `docs/LOCAL_TESTING.md` | You need to functionally test real RPCs locally without hitting the UI login wall | Local docker env, user-impersonation method (no password), business-rule oracle, migration/regression verification, UI-layer credential constraint |

## Domain Source Of Truth

| Domain | First Doc | Then Read | Notes |
| --- | --- | --- | --- |
| Card debt fields and transitions | `docs/CARD_DEBT_TRANSITIONS.md` | `src/utils/financeSummary.ts`, `src/pages/CardsPage*.tsx`, `src/components/finance/LiveReconciliationPanel.tsx`, `src/services/cardLedgerActions.ts`, latest card migrations, `supabase/tests/legacy_current_payment_allocation.sql` | Use this before touching `debt_amount`, `statement_debt_amount`, `current_period_spending`, `provision_amount`, card installments, bank-snapshot reconciliation, or historical payment allocation |
| General finance rules | `docs/FINANCE_RULES.md` | Matching utility under `src/utils/*` | Broad business semantics: assets, cards, payments, loans, debts, goals, dashboard |
| Expense contexts and car operations | `docs/EXPENSE_CONTEXTS_AND_CARS.md` | `src/utils/expenseContexts.ts`, `src/utils/carExpenses.ts`, matching repositories/pages, latest context/car migration | Saf reporting annotations, source separation, fuel measurement, reminders and TCO |
| RPC-backed actions | `docs/RPC_ACTION_REFERENCE.md` | `src/data/repositories/*`, `src/services/*`, `src/types/database.ts`, migrations | Maps Supabase RPCs to user-visible actions and side effects |
| Transaction history side effects | `docs/TRANSACTION_HISTORY.md` | `docs/RPC_ACTION_REFERENCE.md`, latest finance RPC migrations, dashboard/analysis history consumers | Type/source/amount conventions for user-facing activity feed rows |
| Shared payment drawer | `docs/SHARED_PAYMENT_DRAWER_PLAN.md` | `src/hooks/useFinancePaymentDrawer.ts`, `src/components/finance/FinancePaymentDrawer.tsx`, `src/components/finance/AccountPaymentModal.tsx`, `src/services/financePaymentActions.ts`, payment-owning pages | Plan and shared implementation for account-backed payment modals without changing RPC behavior |
| Release/migration compatibility | `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md` | `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `supabase/migrations/*` | Use for schema, RLS, RPC, edge function, or generated type changes |
| Banking simplification | `docs/BANKING_SIMPLIFICATION_AUDIT.md` | `src/pages/CardsPage*.tsx`, `src/components/finance/*`, `docs/CARDS_ARCHITECTURE.md` | Tracks completed banking simplifications and future maintenance notes |
| Uygulama geneli denetim (2026-08-12) | `docs/APPLICATION_AUDIT_2026-08-12.md` | `docs/BACKLOG.md` | Tüm katmanların dosya dosya denetimi: kritik bulgular, ölü kod envanteri, tekrar eden yüzey haritası, faz planı |
| Pipeline/deploy | `docs/PIPELINE.md` | GitHub workflow files, `.lighthouserc.cjs`, and package scripts | CI, deploy, secrets, branch flow |

## Architecture Map

| Layer | Path | Rule |
| --- | --- | --- |
| Domain utilities | `src/utils/*` | Pure calculations and business rules. Prefer tests here. No Supabase imports. |
| Data repositories | `src/data/repositories/*` | Table reads/writes and repository-shaped Supabase access. Return `Result<T>`. |
| Services | `src/services/*` | RPC wrappers and cross-table mutation actions. Direct Supabase calls are intentional here. |
| App hooks | `src/app/*` | TanStack Query cache and use-case hooks. |
| Pages | `src/pages/*` | Route-level orchestration and UI state. Avoid burying new domain math here. |
| Components | `src/components/*` | Reusable UI, finance panels, charts (saf SVG: BarChart, CashFlowChart, LineChart + chartUtils; parça-bütün için `CompositionBar`), selectors, modals. |
| Grafik kategori rengi | `src/components/charts/vizPalette.ts`, `--viz-*` in `src/index.css` | Doğrulanmış kategorik palet: sabit slot sırası, varlığa bağlı atama, döngü yok. Kuralları `docs/UI_ARCHITECTURE.md` § Grafik Rengi. |
| Database | `supabase/migrations/*` | Schema, RLS, triggers, RPCs. Treat migrations as forward-only after production. |
| Edge functions | `supabase/functions/*` | External parsing/quote/push services. Use `_shared/edge.ts` conventions. |

ESLint blocks `src/{pages,components,utils,hooks}` from importing
`src/lib/supabase`. If UI needs data, add or reuse a repository/service wrapper.

## Feature Routes

| Route | Main Files | Data/Utility Neighbors |
| --- | --- | --- |
| `/` dashboard | `docs/DASHBOARD_ARCHITECTURE.md`, `src/pages/DashboardPage.tsx`, `src/components/dashboard/*` | `src/app/useFinanceSnapshot.ts`, `src/data/repositories/financeSnapshotRepo.ts`, `src/utils/dashboard*`, `src/utils/financeSummary.ts`, `src/utils/obligations.ts` |
| `/kartlar` accounts/cards | `docs/CARDS_ARCHITECTURE.md`, `src/pages/CardsPage.tsx`, `src/pages/CardsPage.hooks.ts`, `src/pages/CardsPage.crud.tsx`, `src/pages/CardsPage.sections.tsx`, `src/pages/CardsPage.overview.tsx`, `src/pages/CardsPage.statements.tsx`, `src/pages/CardsPage.expense.tsx`, `src/pages/CardsPage.list.tsx`, `src/pages/CardsPage.helpers.ts`, `src/components/finance/RecentCardExpensesPanel.tsx` (son hareket iptali — BM-6), `src/hooks/useBalancePrivacy.tsx` | `src/data/repositories/cardsRepo.ts`, `src/data/repositories/cardAliasesRepo.ts`, `src/data/repositories/financePanelsRepo.ts`, `src/services/accountMovements.ts`, `src/utils/accountLedger.ts`, `src/utils/cardStatement.ts`, `src/utils/financeSummary.ts` |
| `/odemeler` planned payments | `src/pages/PlanningHub.tsx`, `src/pages/PaymentsPage.tsx` | `src/services/financePaymentActions.ts`, `src/utils/obligations.ts`, `docs/PLANNING_MODEL_REVIEW.md`, `docs/SHARED_PAYMENT_DRAWER_PLAN.md` |
| `/borclar/krediler` loans | `src/pages/LoansPage.tsx`, `src/pages/LoansPage.helpers.ts`, `src/pages/LoansPage.components.tsx` | `src/data/repositories/loansRepo.ts`, `src/services/financePaymentActions.ts`, `src/utils/financeSummary.ts`, `docs/SHARED_PAYMENT_DRAWER_PLAN.md` |
| `/borclar/kisiler` personal debts | `src/pages/DebtsPage.tsx` | `src/services/financePaymentActions.ts`, `docs/SHARED_PAYMENT_DRAWER_PLAN.md` |
| `/borclar/kartlar` credit-card debt | `src/pages/LiabilitiesCardsPage.tsx` | `src/data/repositories/cardsRepo.ts`, `src/hooks/useFinancePaymentDrawer.ts`, `src/utils/financeSummary.ts` (`cardPayableDebt`), `docs/SHARED_PAYMENT_DRAWER_PLAN.md`. Kart borcunu OKUR + `pay_card_debt` ile ödetir; kart ledger/ekstre Hesaplar'da kalır (mükerrer yazma yok). |
| `/varliklar` assets | `src/pages/AssetsPage.tsx`, `src/pages/AssetsPage.tradeModal.tsx`, `src/pages/AssetsHub.tsx`, `src/pages/CarsPage.tsx` (`/varliklar/araclar`) | `src/data/repositories/valuationRepo.ts`, `src/services/assetTrades.ts`, `src/utils/valuation*`, `src/utils/marketRates.ts`, `src/app/useCars.ts`, `src/data/repositories/carsRepo.ts` |
| `/varliklar/maas` salary | `src/pages/SalaryPage.tsx` | `src/utils/financeSummary.ts` salary helpers |
| `/analiz` reports hub | `src/pages/AnalysisHub.tsx`, `src/pages/AnalysisPage.tsx`, `src/pages/AnalysisDetailPage.tsx`, `src/pages/AnalysisPage.data.ts`, `src/pages/AnalysisPage.panels.tsx`, `src/pages/AnalysisPage.reports.tsx`, `src/pages/AnalysisPage.trends.tsx`, `src/pages/AnalysisPage.wealth.tsx` | `src/app/useFinanceSnapshot.ts`, `src/data/repositories/analysisRepo.ts`, `src/utils/analysisView.ts`, charts |
| `/veri-sagligi` data health hub | `docs/DATA_HEALTH_ARCHITECTURE.md`, `src/pages/DataHealthHub.tsx`, `src/pages/DataHealthPage.tsx`, `src/pages/DataHealthOperationsPage.tsx`, `src/pages/DataHealth.resolution.ts`, `src/pages/DataHealthPage.actions.ts`, `src/pages/DataHealthCardExpenseReview.tsx`, `src/pages/DataHealth.logic.ts`, `src/pages/DataHealth.checks.ts`, `src/pages/DataHealth.guide.ts`, `src/pages/DataHealth.actions.ts` | `src/data/repositories/dataHealthRepo.ts` (immutable-PK keyset pagination + optimistic singleton writes + account-wide acknowledgements), `src/services/dataHealthRepairs.ts`, `supabase/migrations/20260803120000_data_health_safe_repairs.sql`, `supabase/migrations/20260803130000_data_health_issue_acknowledgements.sql`, `supabase/tests/data_health_safe_repairs.sql`, `supabase/tests/data_health_issue_acknowledgements.sql`, payment drawer, ledger utilities, finance invariants |
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
| How are card/account ledgers projected? | `src/utils/cardLedger.ts` (`projectCardDebt`, `projectCardSplit`), `src/utils/accountLedger.ts` |
| How are Data Health writes authorized and audited? | `src/pages/DataHealth.resolution.ts`, `src/pages/DataHealthPage.actions.ts`, `src/services/dataHealthRepairs.ts`, and `supabase/migrations/20260803120000_data_health_safe_repairs.sql` (`data_health_repair_runs` / `data_health_repair_steps`); real-DB oracle: `supabase/tests/data_health_safe_repairs.sql` |
| How does “Bu doğru, kapat” persist across devices? | `src/pages/DataHealthPage.tsx`, `src/data/repositories/dataHealthRepo.ts`, `supabase/migrations/20260803130000_data_health_issue_acknowledgements.sql`; real-DB oracle: `supabase/tests/data_health_issue_acknowledgements.sql` |
| How are monthly obligations built? | `src/utils/obligations.ts`; see `docs/PLANNING_MODEL_REVIEW.md` for why this stays a read-side projection instead of one write table. Card current-period cash dates derive from `utils/cardStatement.ts` so paid statement due dates are not reused. |

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
7. `src/pages/DataHealth.resolution.ts` for the exhaustive primary-action policy
8. `src/pages/DataHealthCardExpenseReview.tsx` for duplicate/metadata review
9. `src/services/dataHealthRepairs.ts` and the safe-repair migration/test for
   deterministic server writes
10. `src/pages/DataHealth.actions.ts` for undo/export helpers
11. Relevant invariant helper in `src/utils/*`

Treat data-health fixes as operational writes against real user data. Prefer a
shared helper/DB invariant over a page-only corrective formula. If an expense or
any sibling installment is statement-archived, structural installment findings
must remain manual rather than rewriting historical rows. Every new issue must
resolve to a visible fix, payment, in-page review, or owner-route action; do not
use `fixable` alone as the UI authorization boundary.

For deterministic Data Health RPC changes, verify the migration and receipt/RLS
contract in real Postgres:

```bash
npm run db:seed:local
npm run db:test:data-health-safe-repairs
```

### Migration Or Release Change

Read:

1. `docs/MIGRATION_COMPATIBILITY_CHECKLIST.md`
2. `docs/PIPELINE.md`
3. `.github/workflows/ci.yml`
4. `.github/workflows/deploy.yml`
5. `.lighthouserc.cjs` when changing Lighthouse collection/assertion behavior

Use local Supabase checks when available. Build the production frontend once,
verify that artifact, and upload it with `--prebuilt --skip-domain`. Migrations
and changed edge functions must finish before scoped API promotion; a failed
production smoke check rolls traffic back to the previous deployment.

## Verification Ladder

Choose the smallest ladder that matches the risk:

| Risk | Commands |
| --- | --- |
| Docs-only | `git diff --check` |
| Pure utility change | Targeted Vitest file, then `npm run test:unit` |
| TypeScript/UI change | `npm run lint`, `npm run test:unit`, `npm run build` |
| Route/user-flow change | Previous row plus `npm run test:e2e` when feasible |
| Migration/RPC/RLS change | Previous row plus `npm run db:reset:local`, `npm run db:lint:local`, `npm run db:audit:rls:local`, `npm run db:audit:grants:local` when local Supabase is available; `npm run db:test:all` runs every `supabase/tests/*.sql` (new files are auto-covered in CI too — no per-file wiring, S4) |
| Yeni tablo | Üsttekilere ek: migration'da **explicit `grant`** olmalı (`db:audit:grants:local` zorlar — policy'si olup grant'i olmayan tablo ölü koddur) |
| Bakım/otomatik iş RPC'si | Üsttekilere ek: `npm run db:test:catchup` (idempotency) |
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
| **Ortak UI/UX tasarım sistemi, sayfa şablonu ve performans** | `docs/UI_ARCHITECTURE.md`, `index.css`, `lib/lazyWithReload.ts` | — | `components/Layout.tsx`, `components/BottomNav.tsx`, `components/HubNav.tsx`, `components/navigation.ts`, `components/CrudPage.tsx`, `components/ui/*`, `components/finance/FinanceUI.tsx`, `pages/LoginPage.tsx` |
| **Para hesabı/yuvarlama** | `utils/money.ts` (+ `money.test.ts`, `money.property.test.ts`) | — | — |
| **Arama / metin normalizasyonu** | `utils/searchText.ts`, `utils/categories.ts`, `utils/bankBranding.ts` | — | `components/CrudPage.tsx`, `components/QuickActions.tsx`, `components/dashboard/DashboardCards.tsx`, `pages/AnalysisPage.reports.tsx` |
| **Kart borcu / breakdown** | `utils/cardLedger.ts`, `utils/financeSummary.ts` (`clampCardBreakdown`) | `data/repositories/cardsRepo.ts`, `services/cardLedgerActions.ts`, `supabase/migrations/20260810140000_bank_model_payment.sql` (pay_card_debt residual settlement — kuruş-eşitlik reddi yok; pay_card_debt/pay_card_statement `p_skip_source_debit`), `supabase/migrations/20260802190000_protect_card_allocation_paths.sql` (existing child allocation ve archive lifecycle yalnız kanonik RPC context'i; historical archive INSERT restore için same-card RLS altında açık), `20260802200000_protect_archived_expense_edits.sql` (statement child/parent edit immutability + card→child lock order) | `pages/CardsPage.tsx` (+ `.crud.tsx`, `.helpers.ts`, `.sections.tsx`, `.overview.tsx`, `.control.tsx`, `.statements.tsx`, `.list.tsx`) |
| **Ekstre / statement döngüsü** | `utils/cardStatement.ts`, `utils/statementCycle.ts`, `utils/statementReminder.ts`, `utils/importReviewPeriod.ts`, `utils/statementImportPlan.ts` (+ test; payment/carryover/expense/**needs-review** kararı), `utils/denizBankStatementParser.ts`, `utils/yapiKrediStatementParser.ts`, `utils/importedInstallmentPlan.ts`, `utils/transactionFingerprint.ts` | `data/repositories/cardsRepo.ts` (`replaceCardStatementImport`: PDF tarihine kadar açık scope'u atomik yeniden kurar; paid/current-settled geçmiş + sonraki hareket korunur), `services/cardLedgerActions.ts`, `supabase/migrations/20260809190000_simplify_statement_installments.sql` (PDF importunda eski parent eşleştirmesi yok; yalnız cari+gelecek plan; ekstre ödeme child taksitlerden bağımsız), `supabase/migrations/20260810120000_statement_import_bank_dates.sql` (ödenmiş dönem re-import reddi; PDF kesim/vade tarihi ±7 gün içinde otoritedir), `supabase/migrations/20260810130000_statement_import_reuse_plan.sql` (carryover'da korunan parent sunucuda bulunur — her ay yeni parent açılmaz), `supabase/tests/statement_import_installments.sql`, `scripts/verify-card-statement-regression.sql` | `components/finance/StatementImportModal.tsx` (PDF authoritative replacement; tarihsel taksit sorgusu/eşleştirmesi yok, belirsiz taksit önce doğrulanır), `pages/CardsPage.tsx`, `pages/CardsPage.statements.tsx` |
| **DenizBank güncel hareket mutabakatı** | `utils/denizBankMovementParser.ts` (+ `.test.ts`; eşleşme tuning'i `importMatch.ts`'ten; **PDF'in İKİ kolon düzeni vardır** — `Kart No`/`Kart Tipi` yalnız ek/sanal kartlı üründe basılır, tek kartlıda hiç yoktur → `CARD_COLUMNS_PATTERN` opsiyoneldir ve `cardLastFour` boş olabilir; her iki düzenin golden örneği `utils/__fixtures__/parsers/movement.denizbank-*.txt`), `utils/importMatch.ts` (+ test; movement+ekstre matcher'ın ORTAK tolerans/pencere/seçim kaynağı — tarih 7 gün, tutar max(5TL,%1), uzak pencerede açıklama zorunlu; birini gevşetip diğerini unutma tuzağını kapatır), `utils/importedInstallmentPlan.ts`, `utils/importReviewPeriod.ts`, `utils/transactionFingerprint.ts`, `utils/cardControlCenter.ts` (+ test) | `data/repositories/cardsRepo.ts` (`fetchCardExpenseMatchRows`, `fetchCardInstallmentMatchRows`, `fetchCardPaymentMatchRows`, `addCardExpense`, `recordCardInstallmentCarryover`, `payPaymentFromCardImport`, `cancelCardExpense`), `data/repositories/financePanelsRepo.ts` | `components/finance/CurrentMovementImportModal.tsx`, `pages/CardsPage.tsx`, `pages/CardsPage.control.tsx`, `pages/CardsPage.list.tsx` |
| **Takvim / saat dilimi** | `docs/CARD_DEBT_TRANSITIONS.md` ("Calendar") | `supabase/migrations/20260819120000_istanbul_calendar.sql` (DB varsayılan saat dilimi Europe/Istanbul + `private.today_ist()`; `current_date` kullanan 13 para fonksiyonunu tek noktadan düzeltir), `supabase/tests/installment_intent_and_calendar.sql` | — |
| **Taksit niyeti (SMS öncesi)** | `docs/CARD_DEBT_TRANSITIONS.md` ("Installment capture around the 7-day auto-post") | `data/repositories/cardInstallmentIntentsRepo.ts`, `supabase/migrations/20260819110000_card_installment_intents.sql` (tablo + `private.apply_card_installment_intent` + `record_sms_card_expense` bağlantısı; `private.normalize_match_text` = `utils/searchText.ts` SQL ikizi) | `components/finance/CardInstallmentIntentPanel.tsx` (`/kartlar?section=ekstreler`), `components/finance/RecentCardExpensesPanel.tsx` ("Taksitlendir" onarım yolu) |
| **Taksit takvimi** | `utils/cardInstallmentCalendar.ts` (`INSTALLMENT_COUNT_OPTIONS`/`installmentChoicesWith` — taksit sayısı seçeneklerinin tek kaynağı), `utils/importedInstallmentPlan.ts` | `data/repositories/cardsRepo.ts` (`addCardExpense`, `recordCardInstallmentCarryover`; `due_month` legacy ad, gerçek taksit tarihini taşır) | `pages/CardsPage.tsx`, `pages/CardsPage.expense.tsx`, `components/finance/StatementImportModal.tsx`, `components/finance/CurrentMovementImportModal.tsx` |
| **Banka bakiyesi / hareket / mutabakat** | `utils/accountLedger.ts`, `utils/reconciliation.ts` (`STALE_AFTER_DAYS`=7; push-notify haftalık hatırlatma aynı eşiği kullanır. **Faz D1:** `drift` ham ölçümdür ve düzeltme sonrası DEĞİŞMEZ — DB'de `check (drift = app_amount - real_amount)`; "kapandı mı" sorusu `resolution` kolonunda: `matched`/`open`/`corrected`, NULL = eski kayıt. Durum türetirken `isUnresolvedDrift`'i kullan, `app_amount ≠ real_amount`'a BAKMA — düzeltilmiş kayıt sonsuza dek kırmızı kalır. `buildDriftHistory` sapma desenini verir), `utils/cardControlCenter.ts` (aynı invariant'ı paylaşır), `supabase/migrations/20260811140000_reconciliation_preserves_drift.sql` | `data/repositories/financePanelsRepo.ts`, `services/accountLedgerActions.ts`, `services/accountMovements.ts` | `pages/CardsPage.tsx`, `pages/CardsPage.list.tsx`, `pages/CardsPage.control.tsx`, `components/finance/AccountLedgerPanel.tsx`, `components/finance/LiveReconciliationPanel.tsx`, `components/finance/CurrentMovementImportModal.tsx` (import sonrası akış-içi mutabakat) |
| **Klasik banka/kart UX (IBAN, maskeleme, son hareketler, bakiye gizleme)** | `utils/accountLedger.ts`, `hooks/useBalancePrivacy.tsx`, `pages/CardsPage.helpers.ts` | `data/repositories/cardAliasesRepo.ts`, `data/repositories/financePanelsRepo.ts` | `pages/CardsPage.tsx`, `pages/CardsPage.list.tsx`, `pages/CardsPage.crud.tsx`, `components/finance/FinancePaymentDrawer.tsx` |
| **Kredi & taksitleri** | `utils/financeSummary.ts` (`projectLoanSummary`), `pages/LoansPage.helpers.ts` (ödenmiş plan koruması) | `data/repositories/loansRepo.ts` | `pages/LoansPage.tsx` |
| **Kişisel borç/alacak** | `utils/obligations.ts` | `services/financePaymentActions.ts` (settle/collect kısmi ödeme), `supabase/migrations/20260810190000_partial_personal_debt_and_due_collision.sql` (settle_personal_debt `p_amount` = kısmi; cut_card_statement vade çakışma ötelemesi), `supabase/tests/partial_debt_and_due_collision.sql` | `pages/DebtsPage.tsx`, `LiabilitiesHub.tsx` |
| **Planlı ödemeler** | `utils/dashboardUpcoming.ts`, `utils/attention.ts`, `utils/financeObligationRules.ts`, `utils/paymentHistory.ts` | `services/financePaymentActions.ts` | `pages/PaymentsPage.tsx` |
| **Varlıklar / değerleme / al-sat** | `utils/valuation.ts` (**Faz D3:** `effectiveAssetValueWithSource` & kardeşleri `ValueSource` döner — `live`/`stored`/`manual`. Ekranda "canlı" yazacaksan `source === 'live'` şartını koy; `auto_valued` tek başına yetmez, kur gelmediğinde saklı değere düşülür. Birim kur `assetUnitRate`/`debtUnitRate`/`goalUnitRate`), `utils/valuationSync.ts` (değerle birlikte `valued_at` + `valuation_rate` yazar), `utils/dataConfidence.ts` (`valuationConfidence` → bayatlık rozeti), `utils/realValue.ts` | `data/repositories/valuationRepo.ts`, `services/assetTrades.ts`, `analysisRepo.ts`, `supabase/migrations/20260810180000_asset_trade_proportional_value.sql` (satışta değer miktara oransal; kârda satış serbest, tam satış hayalet değer bırakmaz), `supabase/migrations/20260811160000_valuation_freshness.sql`, `supabase/tests/asset_trade_proportional_value.sql` | `pages/AssetsPage.tsx`, `pages/AssetsPage.tradeModal.tsx`, `AssetsHub.tsx`, `pages/DebtsPage.tsx`, `components/finance/SavingsGoalsPanel.tsx`, `components/dashboard/SeritOverview.tsx` (net değerde kur yaşı uyarısı) |
| **Altın (gram/ledger)** | `utils/goldLedger.ts`, `utils/goldLedgerSync.ts`, `utils/zakat.ts` | `data/repositories/goldLedgerRepo.ts` | `pages/GoldPage.tsx` |
| **Maaş geçmişi** | `utils/lastUsed.ts`, `utils/financeSummary.ts` (`getCurrentSalary`, `getSalaryTrend`) | `data/repositories/crudRepo.ts` | `pages/SalaryPage.tsx` |
| **Birikim hedefleri** | `utils/savingsGoal.ts`, `utils/savingsSuggestion.ts` (aylık gerekli + nakit-akışı tavsiyesi). **DİKKAT — karma (composite) hedefte `target_amount`/`current_amount` TL DEĞİL, bileşen sayısıdır**: toplam bileşen ve hedefine ulaşan bileşen. Bunları para gibi biçimlendirme/toplama (`formatAmount`, `diffTL`) — `formatSavingsGoalAmount` kullan ya da composite'i ayıkla (`savingsSuggestion.ts`, `analysisView.buildSearchItems` guard'lı). Hedef matematiği TEK yerde: `savingsGoal.ts` + `savingsSuggestion.ts` — `financeSummary.ts`'te ikinci bir "aylık gerekli" hesabı açma, Faz D2'deki hata tam olarak iki implementasyondan birinin guard'sız kalmasıydı. **Faz D2:** sayaçlar `upsert_savings_goal` içinde `p_components`'tan türetilir, client'tan gelen değer yok sayılır — client'ta ikinci bir hesap TUTMA | `data/repositories/savingsGoalsRepo.ts`, `supabase/migrations/20260811150000_composite_goal_totals_from_components.sql`, `supabase/tests/composite_goal_totals.sql` | `components/finance/SavingsGoalsPanel.tsx` (Assets/Dashboard); surplus `pages/PlanningPage.tsx`'ten geçer |
| **Bütçe uyarıları** | `utils/budgetAlerts.ts` | `data/repositories/crudRepo.ts` | `pages/CardsPage.tsx` |
| **Dashboard özet/insight** | `utils/dashboardInsights.ts`, `utils/cashFlowForecast.ts`, `utils/dashboardUpcoming.ts`, `utils/obligations.ts`, `utils/financeObligationRules.ts`, `utils/netWorthSeries.ts`, `utils/dataHealthSummary.ts` | `data/repositories/financeSnapshotRepo.ts` | `pages/DashboardPage.tsx` |
| **Gerçekleşen nakit çıkışı (rapor)** | `utils/realizedCashFlow.ts` (+ test; projeksiyon DEĞİL, işlem geçmişinden) | `financeSnapshotRepo.ts` | `pages/AnalysisPage.reports.tsx` (MonthlyReport) |
| **Günlük net değer fotoğrafı** | `utils/financeSummary.ts` (`buildFinancialPosition`) | `data/repositories/analysisRepo.ts` (`recordNetWorthSnapshot`, `fetchNetWorthSnapshots`) | `app/useDailyNetWorthSnapshot.ts` (Layout'a bağlı, günde bir) |
| **Analiz / raporlar** | `utils/analysisView.ts`, `utils/subscriptions.ts`, `utils/priceIncreaseRadar.ts`, `utils/yearEndReport.ts` (+ tests) | `data/repositories/analysisRepo.ts` | `pages/AnalysisHub.tsx`, `pages/AnalysisPage.tsx`, `pages/AnalysisDetailPage.tsx` |
| **Aktivite akışı (audit trail)** | `utils/activityFeed.ts` | `data/repositories/financePanelsRepo.ts` | `pages/AnalysisPage.activity.tsx` (ActivityFeedPanel) |
| **Arabalarım (araç gideri)** | `utils/carExpenses.ts` (+ test; toplam/ay/yıl/TCO, yakıt full-to-full ölçümü, hatırlatıcı durumu; kart-etiketli + kart-dışı manuel giderleri çift saymadan birleştirir — SAF), `utils/carTcoCard.ts`, `app/useCars.ts` | `data/repositories/carsRepo.ts` (cars/car_expenses/car_reminders CRUD + saf kart annotation'ı), `supabase/migrations/20260804120000_add_cars.sql`, `supabase/migrations/20260804150000_add_expense_contexts_and_car_operations.sql` | `pages/CarsPage.tsx` (`/varliklar/araclar`: araç, yakıt, bakım/yenileme, TCO ve indirilebilir karne), `pages/CardsPage.expense.tsx` (Hızlı harcama araç seçici), `functions/push-notify` (tarihli işe 7 gün kala) |
| **Gider bağlamları (evcil hayvan / etkinlik-proje)** | `docs/EXPENSE_CONTEXTS_AND_CARS.md`, `utils/expenseContexts.ts` (+ test; kart + kart-dışı birleşik saf mercek, bütçe burn-down), `app/useExpenseContexts.ts` | `data/repositories/expenseContextsRepo.ts` (expense_contexts/context_expenses CRUD + card_expenses.context_id annotation), `data/repositories/cardsRepo.ts` (`fetchTaggableCardExpenses`: etiketlenebilir liste = posted + provision), `supabase/migrations/20260804150000_add_expense_contexts_and_car_operations.sql`, `supabase/migrations/20260811100000_partial_provision_keeps_context.sql` (kısmi provizyon bağlamı taşır; `supabase/tests/partial_provision_context.sql`) | `pages/ExpenseContextsPage.tsx` (`/odemeler/baglamlar`: bağlam yönetimi, manuel gider, kart etiketi, proje bütçesi/burn-down) |
| **Kredi kartı borcu (Borçlar bağlamı)** | `utils/financeSummary.ts` (`cardPayableDebt`), `utils/cardStatement.ts` (`getCardStatementPeriod`) | `data/repositories/cardsRepo.ts` (`fetchCards`), `hooks/useFinancePaymentDrawer.ts` (`pay_card_debt`) | `pages/LiabilitiesCardsPage.tsx` (`/borclar/kartlar`: kart borcunu göster + öde; Hesaplar'daki `openDebtPayment` desenini + aynı drawer/RPC'yi yeniden kullanır, mükerrer yazma yok) |
| **Kart tutarlılık skoru** | `utils/cardConsistency.ts` (+ test) | — | `pages/CardsPage.list.tsx` (skor badge) |
| **Bütçe & birikim hedefleri (planlama)** | `utils/savingsGoal.ts`, `utils/budgetAlerts.ts` | `data/repositories/savingsGoalsRepo.ts` | `pages/PlanningHub.tsx`, `pages/PlanningPage.tsx`, `components/finance/SavingsGoalsPanel.tsx` |
| **Kasa modu (bucket → gerçek harcanabilir)** | `utils/kasaMode.ts` (+test; likit − rezerve), `utils/safeToSpend.ts` (`reserved` alanı) | `data/repositories/kasaBucketsRepo.ts`, `supabase/migrations/20260728120000_add_kasa_buckets.sql` | `components/finance/KasaModuPanel.tsx` (PlanningPage), `hooks/useSafeToSpend.ts` (rezerve düşülür) |
| **Alışveriş listesi** | — | `data/repositories/wishlistRepo.ts` | `pages/WishlistPage.tsx` |
| **Finansal rapor (PDF/AI paylaşım)** | `utils/financialReport.ts` | — | `pages/AnalysisDetailPage.tsx`, `pages/AnalysisPage.reports.tsx` |
| **Aylık özet / kategori dağılımı** | `utils/monthlySummary.ts` | — | `pages/AnalysisPage.reports.tsx` (MonthlyReport) |
| **Abonelik / sabit gider yönetimi** | `utils/subscriptions.ts` | — | `pages/AnalysisPage.panels.tsx` (SubscriptionsPanel) |
| **Paylaşılabilir özet kartı** | `utils/shareableCard.ts` | — | `pages/AnalysisPage.reports.tsx` (MonthlyReport "Kart" butonu) |
| **Yıl sonu finansal rapor** | `utils/yearEndReport.ts` | — | `pages/AnalysisPage.reports.tsx` (YearEndReport) |
| **Forecast / senaryo / FIRE / enflasyon** | `utils/cashFlowForecast.ts`, `utils/scenarioForecast.ts`, `utils/financeObligationRules.ts`, `utils/inflationShield.ts` | `financeSnapshotRepo.ts` | `pages/DashboardPage.tsx`, `pages/AnalysisPage.tsx`, `pages/AnalysisDetailPage.tsx` |
| **Veri sağlığı / onarım** | `pages/DataHealth.logic.ts` (types + orchestrator), `pages/DataHealth.checks.ts` (domain checks), `utils/financeSummary.ts` (trigger TS ikizleri), `utils/transactionFingerprint.ts` (kart harcaması duplicate/fingerprint) | `data/repositories/dataHealthRepo.ts` | `pages/DataHealthHub.tsx`, `pages/DataHealthPage.tsx`, `pages/DataHealthOperationsPage.tsx` |
| **Kategori eşleme (tr-TR tuzağı)** | `utils/categories.ts` (`normalizeDescription`; import parser'ları `CategoryMemory` parametresi alır; **kanonik liste burada — DEĞİŞTİRİRSEN 4 aynayı da güncelle:** `supabase/functions/parse-sms/index.ts` `CATEGORY_RULES`, `supabase/functions/parse-receipt/index.ts` `CATEGORIES`, `utils/denizBankStatementParser.ts` `SECTION_CATEGORY`, ve safe-repair RPC'sindeki beyaz liste — kategori DB'de serbest metindir, yeniden adlandırma mevcut satırları güncelleyen bir migration ister; örnek: `20260816120000_rename_yemek_category.sql`. **Kategori EKLERKEN `components/charts/vizPalette.ts` + `index.css` `--viz-N` de büyümeli** — slot yetmezse yeni kategori sessizce nötre düşer ve grafikte "Diğer" ile aynı renk olur; `vizPalette.test.ts` bunu kırar. Eşleşme `foldForMatch` ile aksan-katlanmış uzayda yapılır ama `normalizeDescription` CategoryMemory anahtarıdır, ona DOKUNMA) | `data/repositories/categoryMemoryRepo.ts`, `data/repositories/cardsRepo.ts` (`fetchUncategorizedExpenses`, `updateCardExpenseCategory`) | `components/finance/CategoryCleanupPanel.tsx` (`/kartlar?section=islemler` "Diğer" eritme) |
| **Son harcamayı tekrarla** | `utils/expenseRepeat.ts` (+test; açıklamaya göre tekilleştir) | `data/repositories/cardsRepo.ts` (`fetchRecentCardExpenses`) | `pages/CardsPage.expense.tsx` (Hızlı harcama üstündeki tekrarla çipleri) |
| **Yedek / backup** | `utils/backup.ts` (+ `backup.test.ts`, `backup.restore.test.ts`; ledgers, operasyon logları ve immutable current-settlement kanıtı export-only; alias/dismiss/push/wishlist/kasa/notification preferences restore edilir; malformed rows reset öncesi reddedilir) | `data/repositories/backupRepo.ts` (keyset export + transactional reset RPC), `supabase/migrations/20260802170000_complete_backup_reset_scope.sql` (restore replay atomik değildir; tarihsel archive-marker INSERT same-user/card RLS ile doğrulanır) | (DataHealth) |
| **Push bildirim** | `utils/notificationPreferences.ts` (+test; tür→tercih + sessiz saat, edge ikizi; `quietHoursMuteDailyPush` — cron TEK saat (07:00) çalıştığı için o saati kapsayan sessiz aralık pratikte "kapalı" demektir, UI uyarır) | `data/repositories/pushSubscriptionsRepo.ts`, `data/repositories/notificationPreferencesRepo.ts` (tercih upsert + son gönderim), `services/pushNotifications.ts`, `lib/pushClient.ts` (`syncPushSubscription` + `shouldSyncPushSubscription`; 410/endpoint rotasyonuyla ölen aboneliği sessizce onarır — opt-out bayrağı olmadan kullanıcı bildirimleri kapatamaz), `hooks/usePushSubscriptionSync.ts` (açılışta onarım), `supabase/migrations/20260617102826_add_notification_log.sql`, `supabase/migrations/20260729120000_add_notification_preferences.sql`, `supabase/migrations/20260819100000_provision_installment_reminder_pref.sql` (`provisions_enabled`), `.github/workflows/push-notify.yml` | `supabase/functions/push-notify` (tercih/sessiz-saat kapısı, `provision_installment_pending` adayı), `public/sw.js`, `components/finance/NotificationSettings.tsx` (tür toggle + sessiz saat + son gönderim) |
| **SMS harcama otomasyonu** | `utils/smsParser.ts` (+test; canlı edge parser aynası, DenizBank format/tutar/+03:00), `utils/categories.ts` (inferExpenseCategory), `utils/sourceEventId.ts` (artefakt hash / import satır kimliği), `utils/subscriptions.ts` (ödeme-planına bağlı kart hareketini abonelikte ikinci kez saymaz) | `data/repositories/cardAliasesRepo.ts`, `data/repositories/smsLogRepo.ts` (`fetchUnrecognizedSmsLog`), `supabase/migrations/20260626120000_add_sms_log.sql`, `supabase/migrations/20260702120000_tolerant_sms_account_matching.sql` (hesap no toleranslı eşleşme), `supabase/migrations/20260802120000_sms_account_movement_use_occurred_at.sql` (occurred_at = gerçek SMS zamanı), `supabase/migrations/20260802140000_card_expense_source_event_id.sql` (kart retry idempotency), `supabase/migrations/20260802180000_sms_account_movement_idempotency.sql` (hesap retry idempotency + service-role-only RPC), `supabase/migrations/20260809200000_reconcile_sms_card_auto_payments.sql` (kart SMS'i ↔ otomatik ödeme planı çapraz-kaynak tekilleştirme), `supabase/tests/sms_card_payment_reconciliation.sql` | `supabase/functions/parse-sms`, `components/finance/CardAliasPanel.tsx`, `components/finance/SmsLogPanel.tsx` (`/veri-sagligi/islemler`) |
| **Otomasyon kapsamı (kaynak ölçümü)** | `utils/automationCoverage.ts` (+ test; `card_expenses.source`, note fallback) | `data/repositories/cardsRepo.ts` (`fetchExpenseSourceRows`), `supabase/migrations/20260727140000_add_card_expense_source.sql` | `components/finance/AutomationCoveragePanel.tsx` (`/veri-sagligi/islemler`) |
| **Harcanabilir tutar (tek sayı)** | `utils/safeToSpend.ts` (+ test; likit + kalan gelir − kalan yükümlülük − tampon − kasa rezervi). **KURAL:** `buildSafeToSpend`'i `reserved` OLMADAN çağırma — sayı ekrandan ekrana farklı çıkar; rezervi `hooks/useSafeToSpend.ts`'teki `useKasaReserved` verir. `utils/safeToSpend.guard.test.ts` bunu CI'da zorlar | `financeSnapshotRepo.ts`, `data/repositories/kasaBucketsRepo.ts` | `hooks/useSafeToSpend.ts` (tampon + kasa rezervi), `components/dashboard/SeritOverview.tsx` (Özet kahraman rakamı), `components/dashboard/SeritBufferRow.tsx` (tampon düzenleme), `pages/PurchaseDecisionPage.tsx`, `pages/PlanningPage.tsx` |
| **Şerit görsel dili (kartsız)** | `utils/dashboardMonthStrip.ts` (+ test; ay şeridi türevi), `utils/formatCurrency.ts` (`formatSeritParts`/`formatSeritAmount`, sembol sonda — `useBalancePrivacy` bunu kullanır) | — | `components/serit/*` (ortak parçalar; Card bileşeni YOK), `components/Layout.tsx` + `components/BottomNav.tsx` + `components/QuickActions.tsx` (kabuk `4e`, FAB 76px ayrılmış bant), `components/HubNav.tsx` (2px jade sekme şeridi), `components/dashboard/Serit*.tsx`, `pages/AnalysisPage.hero.tsx`, `pages/CardsPage.hero.tsx`, `src/index.css` (`--page`/`--ink*`/`--line*`/`--signal-*` + `.serit-num`/`.serit-eyebrow`) |
| **Karar anı ("alsam mı")** | `utils/purchaseImpact.ts` (+ test; kartta ilk taksit sonraki ekstrede), `utils/cashFlowForecast.ts` | `financeSnapshotRepo.ts` | `pages/PurchaseDecisionPage.tsx` (`/alsam-mi`, QuickActions ilk sırada) |
| **Rakam güven dili (kesin/tahmini/bayat)** | `utils/dataConfidence.ts` (+ test) | — | `components/ui/confidence-badge.tsx`, `pages/CardsPage.control.tsx`, `pages/CardsPage.list.tsx`, `components/finance/RatesBanner.tsx` |
| **Piyasa kuru / BIST** | `utils/marketRates.ts` | — | `supabase/functions/bist-quote` |
| **Hisse fiyatları (canlı)** | `hooks/useStockPrices.ts` | — | `pages/AssetsPage.tsx` (Hisse satırları), `supabase/functions/bist-quote` |
| **Fiş tarama (foto → kart harcaması)** | — | `lib/receiptParseClient.ts` | `supabase/functions/parse-receipt`, `pages/CardsPage.expense.tsx` (Hızlı harcama fiş yükleme) |
| **Genel ekstre parse fallback (bilinmeyen banka PDF'i)** | `utils/denizBankStatementParser.ts`, `utils/yapiKrediStatementParser.ts` (önce yerel parser'lar) | `lib/statementParseClient.ts` | `supabase/functions/parse-statement`, `components/finance/StatementImportModal.tsx` |
| **Pull-to-refresh** | `hooks/usePullToRefresh.ts` | — | `components/PullToRefresh.tsx` (Layout `main` sarmalayıcısı) |
| **Kısmi ekstre ödemesi (kalan türetimi)** | `utils/cardStatementPayments.ts` (kalan = arşiv − ödemeler; SQL ikizi `private.statement_remaining_amount`) | `data/repositories/cardsRepo.ts` (`fetchStatementPayments`), `supabase/migrations/20260812110000_partial_statement_payments.sql`, `supabase/tests/partial_statement_payment.sql` | `pages/CardsPage.statements.tsx`, `pages/CardsPage.hero.tsx`, `utils/cardControlCenter.ts`, `pages/LiabilitiesCardsPage.tsx`, `utils/obligations.ts` |
| **Modal/popover erişilebilirlik sözleşmesi** | `components/ui/use-dialog-a11y.ts` (odak içeri → Tab hapsi → Escape → odağı tetikleyiciye geri ver) | — | `components/SimpleModal.tsx`, `components/ui/confirm-dialog.tsx`, `components/QuickActions.tsx`, `components/Layout.tsx`, iki import modalı |
| **Sorgu hatası yüzeyi** | `components/ui/query-error.tsx` (`role="alert"` + "Tekrar dene") | — | `pages/AnalysisPage.tsx`, `pages/AnalysisDetailPage.tsx`, `pages/PlanningPage.tsx`, `pages/PurchaseDecisionPage.tsx`, `pages/AssetsPage.tsx` |
| **Şema / tip / RPC kontratı** | — | `src/types/database.ts` | — |
| **Migration / trigger** | `utils/financeSummary.ts` (saf TS ikizleri) | `supabase/migrations/*` | — |

Sık dokunulan, UI+iş kuralı karışık dosyalar: `DashboardPage.tsx`, `CardsPage.tsx`,
`DataHealthPage.tsx`, `financeSummary.ts` — değişiklikte dashboard + veri sağlığı
yan etkisini kontrol et.
