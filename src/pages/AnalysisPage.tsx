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
} from './AnalysisPage.panels'
import { useAnalysisPageData } from './AnalysisPage.data'
import { AnalysisHero } from './AnalysisPage.hero'
import { FeatureSection } from '../components/FeatureSection'

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
  const { data, error, loading, missingTables, priceTrends, ratesSnapshot, snapshots, auxiliaryError, retryAuxiliary, auxiliaryLoading } = useAnalysisPageData()
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
      {auxiliaryError ? <QueryError title="Geçmiş veriler yüklenemedi" message="Trend ve fiyat karşılaştırmaları şu an doğrulanamıyor." onRetry={() => void retryAuxiliary()} /> : null}
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <FeatureSection id="aylik-rapor" className="lg:col-span-12"><MonthlyReport data={data} /></FeatureSection>
        <AnalysisHero data={data} snapshots={snapshots} historyStatus={auxiliaryError ? "error" : auxiliaryLoading ? "loading" : "ready"} />
        <SchemaMigrationNotice missingTables={missingTables} />
        <FeatureSection id="ay-kapanisi" className="lg:col-span-12"><MonthCloseAssistant data={data} missingTables={missingTables} /></FeatureSection>
        {/* 7+5 çiftleri: kategori dağılımı ve abonelikler yan yana; fiyat radarı
            (veri yoksa null döner) tam satır — sağ yarı boş kalmasın (UX turu B14). */}
        <FeatureSection id="kategori-analizi" className="lg:col-span-7"><CategorySpendingChart data={data} /></FeatureSection>
        <FeatureSection id="abonelikler" className="lg:col-span-5"><SubscriptionsPanel data={data} /></FeatureSection>
        {!auxiliaryError && !auxiliaryLoading ? <PriceIncreaseRadar trends={priceTrends} /> : null}
        {!auxiliaryError && !auxiliaryLoading ? <NetWorthTrend snapshots={snapshots} ratesSnapshot={ratesSnapshot} /> : null}
        <ForwardForecast data={data} />
      </div>
    </section>
  )
}
