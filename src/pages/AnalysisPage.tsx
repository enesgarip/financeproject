import { FullMonthCalendarPanel } from './AnalysisPage.calendar'
import {
  CashFlowTrend,
  ForwardForecast,
  NetWorthTrend,
} from './AnalysisPage.trends'
import { MonthlyReport } from './AnalysisPage.reports'
import { CategorySpendingChart } from './AnalysisPage.wealth'
import {
  FinancialCalendar,
  MonthCloseAssistant,
  PeriodComparisonPanel,
  PriceIncreaseRadar,
  QuietDaysPanel,
  SchemaMigrationNotice,
  SubscriptionsPanel,
  UpcomingInstallments,
} from './AnalysisPage.panels'
import { useAnalysisPageData } from './AnalysisPage.data'

export function AnalysisPage() {
  const { data, error, loading, missingTables, priceTrends, ratesSnapshot, snapshots } = useAnalysisPageData()

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <SchemaMigrationNotice missingTables={missingTables} />
        <MonthCloseAssistant data={data} missingTables={missingTables} />
        <MonthlyReport data={data} />
        <UpcomingInstallments data={data} />
        <FinancialCalendar data={data} />
        <CategorySpendingChart data={data} />
        <PeriodComparisonPanel data={data} />
        <PriceIncreaseRadar trends={priceTrends} />
        <CashFlowTrend data={data} />
        <NetWorthTrend snapshots={snapshots} ratesSnapshot={ratesSnapshot} />
        <ForwardForecast data={data} />
        <SubscriptionsPanel data={data} />
        <QuietDaysPanel data={data} />
        <FullMonthCalendarPanel data={data} />
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Analiz verileri yükleniyor...</p> : null}
    </section>
  )
}
