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
import { PageCommandHeader } from '../components/finance/FinanceUI'

export function AnalysisPage() {
  const { data, error, loading, missingTables, priceTrends, ratesSnapshot, snapshots } = useAnalysisPageData()

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="space-y-5">
      <PageCommandHeader
        label="Finansal istihbarat"
        title="Aylık karar merkezi"
        description="Ay kapanışı, harcama dağılımı, yaklaşan yük ve ileriye dönük nakit görünümünü birlikte değerlendir."
        meta={loading ? 'Veriler güncelleniyor' : 'Güncel finans görünümü'}
      />
      <div className="grid gap-5 lg:grid-cols-12">
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

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Analiz verileri yükleniyor...</p> : null}
    </section>
  )
}
