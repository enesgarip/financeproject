import {
  SearchExport,
  StatementArchive,
  YearEndReport,
} from './AnalysisPage.reports'
import { useAnalysisPageData } from './AnalysisPage.data'

export function AnalysisRecordsPage() {
  const { data, error, loading, searchItems, snapshots } = useAnalysisPageData()

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <YearEndReport data={data} snapshots={snapshots} />
        <SearchExport items={searchItems} />
        <StatementArchive data={data} />
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Kayıtlar yükleniyor...</p> : null}
    </section>
  )
}
