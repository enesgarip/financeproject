import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { QueryError } from '../components/ui/query-error'
import { SkeletonCard, SkeletonHero } from '../components/ui/skeleton'
import { ForwardForecast, NetWorthTrend } from './AnalysisPage.trends'
import { MonthlyReport } from './AnalysisPage.reports'
import { CategorySpendingChart } from './AnalysisPage.wealth'
import {
  MonthCloseAssistant,
  PriceIncreaseRadar,
  SchemaMigrationNotice,
  SubscriptionsPanel,
  UpcomingInstallments,
} from './AnalysisPage.panels'
import { useAnalysisPageData } from './AnalysisPage.data'
import { AnalysisHero } from './AnalysisPage.hero'

/**
 * Yüklenirken paneller BOŞ VERİYLE çizilmez. Eskiden yükleme göstergesi sayfanın
 * en altındaydı ve panellerin hepsi `emptyAnalysisData` ile render ediliyordu:
 * "Maaş eklenmedi" gibi yanlış durumlar bir an parlıyordu (denetim 2026-08-12 §6).
 * Dashboard'ın skeleton yaklaşımının aynısı.
 */
function AnalysisSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Analiz verileri yükleniyor"
      className="grid gap-5 lg:grid-cols-12"
    >
      <span className="sr-only">Analiz verileri yükleniyor</span>
      <div className="lg:col-span-12">
        <SkeletonHero />
      </div>
      <div className="lg:col-span-6">
        <SkeletonCard lines={4} />
      </div>
      <div className="lg:col-span-6">
        <SkeletonCard lines={4} />
      </div>
      <div className="lg:col-span-12">
        <SkeletonCard lines={6} />
      </div>
    </div>
  )
}

export function AnalysisPage() {
  const { data, error, loading, missingTables, priceTrends, ratesSnapshot, snapshots } = useAnalysisPageData()
  // Aynı TanStack sorgusu (paylaşılan cache) — yalnız "Tekrar dene" için gerekiyor.
  const snapshotQuery = useFinanceSnapshot()

  if (loading) return <AnalysisSkeleton />

  if (error) {
    return (
      <QueryError
        title="Analiz verileri yüklenemedi"
        message={error}
        onRetry={() => void snapshotQuery.refetch()}
        retrying={snapshotQuery.isFetching}
      />
    )
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-12">
        <AnalysisHero data={data} snapshots={snapshots} />
        <SchemaMigrationNotice missingTables={missingTables} />
        <MonthCloseAssistant data={data} missingTables={missingTables} />
        <MonthlyReport data={data} />
        <UpcomingInstallments data={data} />
        <CategorySpendingChart data={data} />
        <PriceIncreaseRadar trends={priceTrends} />
        <NetWorthTrend snapshots={snapshots} ratesSnapshot={ratesSnapshot} />
        <ForwardForecast data={data} />
        <SubscriptionsPanel data={data} />
      </div>
    </section>
  )
}
