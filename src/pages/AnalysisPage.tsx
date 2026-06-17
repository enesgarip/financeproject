import { MonthlyReport } from './AnalysisPage.reports'
import { CategorySpendingChart } from './AnalysisPage.wealth'
import {
  FinancialCalendar,
  MonthCloseAssistant,
  SchemaMigrationNotice,
  UpcomingInstallments,
} from './AnalysisPage.panels'
import { useAnalysisPageData } from './AnalysisPage.data'

export function AnalysisPage() {
  const { data, error, loading, missingTables } = useAnalysisPageData()

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
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Analiz verileri yükleniyor...</p> : null}
    </section>
  )
}
