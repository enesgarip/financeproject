# Navigation Map — task → dosya

> Amaç: bir işe başlarken keşif turu (grep fan-out) atmamak. "Şu konuya
> dokunacaksan önce şu dosyalara bak." Liste bağlayıcı değil, başlangıç noktasıdır.
> Kanonik kurallar: `CLAUDE.md`. Daha geniş router (domain dokümanı + playbook +
> doğrulama merdiveni): `docs/AI_CONTEXT_INDEX.md`. Bu dosya = hızlı konu→dosya tablosu.

## Mimari katmanlar (ESLint ile zorlanır)

```
domain   → src/utils/*               Saf hesap/iş kuralı. Supabase görmez. Yoğun test.
data     → src/data/repositories/*   TEK Supabase teması. Result<T> döndürür.
app      → src/app/*                 TanStack Query use-case hook'ları.
ui       → src/pages, src/components  "Aptal" sunum. Supabase görmez.
services → src/services/*            RPC sarmalayıcıları (kasıtlı; doğrudan supabase).
lib      → src/lib/*                 supabase client, sentry, harici istemciler.
```

Paylaşılan veri: `src/app/useFinanceSnapshot.ts` (Dashboard + Analysis aynı cache'i
paylaşır; her sayfa süpersetini client-side daraltır). Query client: `src/app/queryClient.ts`.

## Konu → dosya tablosu

| İş / konu | Önce bak (domain/util) | Veri katmanı | UI |
|---|---|---|---|
| **Para hesabı/yuvarlama** | `utils/money.ts` (+ `money.test.ts`, `money.property.test.ts`) | — | — |
| **Kart borcu / breakdown** | `utils/cardLedger.ts`, `utils/financeSummary.ts` (`clampCardBreakdown`) | `data/repositories/cardsRepo.ts`, `services/cardLedgerActions.ts` | `pages/CardsPage.tsx` (+ `.helpers.ts`, `.sections.tsx`) |
| **Ekstre / statement döngüsü** | `utils/cardStatement.ts`, `utils/statementCycle.ts`, `utils/statementReminder.ts` | `data/repositories/cardsRepo.ts` | `pages/CardsPage.tsx` |
| **Taksit takvimi** | `utils/cardInstallmentCalendar.ts` | `data/repositories/cardsRepo.ts` | `pages/CardsPage.tsx` |
| **Banka bakiyesi / hareket / mutabakat** | `utils/accountLedger.ts`, `utils/reconciliation.ts` | `data/repositories/financePanelsRepo.ts`, `services/accountLedgerActions.ts`, `services/accountMovements.ts` | `pages/CardsPage.tsx` |
| **Kredi & taksitleri** | `utils/financeSummary.ts` (`projectLoanSummary`) | `data/repositories/loansRepo.ts` | `pages/LoansPage.tsx` |
| **Kişisel borç/alacak** | `utils/obligations.ts`, `utils/obligationPresets.ts` | `data/repositories/debtsRepo.ts` | `pages/DebtsPage.tsx`, `LiabilitiesHub.tsx` |
| **Planlı ödemeler** | `utils/dashboardUpcoming.ts`, `utils/attention.ts` | `data/repositories/paymentsRepo.ts`, `services/financePaymentActions.ts` | `pages/PaymentsPage.tsx` |
| **Varlıklar / değerleme** | `utils/valuation.ts`, `utils/valuationSync.ts`, `utils/realValue.ts` | `data/repositories/valuationRepo.ts`, `analysisRepo.ts` | `pages/AssetsPage.tsx`, `AssetsHub.tsx` |
| **Altın (gram/ledger)** | `utils/goldLedger.ts`, `utils/goldLedgerSync.ts`, `utils/zakat.ts` | `data/repositories/goldLedgerRepo.ts` | `pages/GoldPage.tsx` |
| **Maaş geçmişi** | `utils/lastUsed.ts` | `data/repositories/crudRepo.ts` | `pages/SalaryPage.tsx` |
| **Birikim hedefleri** | `utils/savingsGoal.ts` | `data/repositories/savingsGoalsRepo.ts` | (Assets/Dashboard) |
| **Bütçe uyarıları** | `utils/budgetAlerts.ts` | `data/repositories/crudRepo.ts` | `pages/CardsPage.tsx` |
| **Dashboard özet/insight** | `utils/dashboardInsights.ts`, `utils/cashFlowForecast.ts`, `utils/netWorthSeries.ts` | `data/repositories/financeSnapshotRepo.ts` | `pages/DashboardPage.tsx` |
| **Analiz / raporlar** | `utils/analysisView.ts`, `utils/spendingAnomalies.ts`, `utils/priceIncreaseRadar.ts` | `data/repositories/analysisRepo.ts` | `pages/AnalysisPage.tsx` |
| **Finansal rapor (PDF/AI paylaşım)** | `utils/financialReport.ts` | — | `pages/AnalysisPage.tsx` |
| **Forecast / senaryo / FIRE / enflasyon** | `utils/cashFlowForecast.ts`, `utils/scenarioForecast.ts`, `utils/fire.ts`, `utils/inflationShield.ts` | `financeSnapshotRepo.ts` | `pages/DashboardPage.tsx`, `AnalysisPage.tsx` |
| **Veri sağlığı / onarım** | `pages/DataHealth.logic.ts`, `utils/financeSummary.ts` (trigger TS ikizleri) | `data/repositories/dataHealthRepo.ts` | `pages/DataHealthPage.tsx` |
| **Kategori eşleme (tr-TR tuzağı)** | `utils/categories.ts` (`normalizeDescription`) | `data/repositories/categoryMemoryRepo.ts` | — |
| **Yedek / backup** | `utils/backup.ts` | `data/repositories/backupRepo.ts` | (DataHealth) |
| **Push bildirim** | — | `data/repositories/pushSubscriptionsRepo.ts` | `supabase/functions/*` |
| **Piyasa kuru / BIST** | `utils/marketRates.ts` | — | `supabase/functions/bist-quote` |
| **Şema / tip / RPC kontratı** | — | `src/types/database.ts` | — |
| **Migration / trigger** | `utils/financeSummary.ts` (saf TS ikizleri) | `supabase/migrations/*` | — |

## Edge fonksiyonları

`supabase/functions/*` — ortak modül `supabase/functions/_shared/edge.ts` (CORS,
timeout'lu fetch). Sentry edge'e **konmadı**; loglar yeterli. Mevcut: `bist-quote`,
`parse-receipt`. Hepsi IP-bazlı rate-limit'li.

## Sık dokunulan, dikkat isteyen dosyalar (UI + iş kuralı karışık)

`DashboardPage.tsx`, `CardsPage.tsx`, `DataHealthPage.tsx`, `financeSummary.ts`.
Bunlarda değişiklik yaparken dashboard + veri sağlığı yan etkisini kontrol et.
