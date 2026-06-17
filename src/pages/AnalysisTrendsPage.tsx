import { FullMonthCalendarPanel } from './AnalysisPage.calendar'
import {
  CashFlowTrend,
  ForwardForecast,
  NetWorthTrend,
} from './AnalysisPage.trends'
import {
  PeriodComparisonPanel,
  PriceIncreaseRadar,
  QuietDaysPanel,
  SubscriptionsPanel,
} from './AnalysisPage.panels'
import { useAnalysisPageData } from './AnalysisPage.data'

export function AnalysisTrendsPage() {
  const { data, error, loading, priceTrends, ratesSnapshot, snapshots } = useAnalysisPageData()

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <PeriodComparisonPanel data={data} />
        <PriceIncreaseRadar trends={priceTrends} />
        <CashFlowTrend data={data} />
        <NetWorthTrend snapshots={snapshots} ratesSnapshot={ratesSnapshot} />
        <ForwardForecast data={data} />
        <SubscriptionsPanel data={data} />
        <QuietDaysPanel data={data} />
        <FullMonthCalendarPanel data={data} />
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Trend verileri yükleniyor...</p> : null}
    </section>
  )
}
