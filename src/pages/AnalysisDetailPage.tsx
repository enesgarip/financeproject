import {
  FireCalculator,
  InflationShieldPanel,
  ZakatPanel,
} from './AnalysisPage.wealth'
import { LoanAffordabilityPanel } from './AnalysisPage.loan'
import {
  SearchExport,
  StatementArchive,
  YearEndReport,
} from './AnalysisPage.reports'
import {
  MilestonesPanel,
  PeopleLedger,
} from './AnalysisPage.panels'
import { useAnalysisPageData } from './AnalysisPage.data'

export function AnalysisDetailPage() {
  const { data, error, loading, ratesSnapshot, searchItems, snapshots } = useAnalysisPageData()

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <LoanAffordabilityPanel data={data} />
        <InflationShieldPanel data={data} />
        <ZakatPanel data={data} ratesSnapshot={ratesSnapshot} />
        <FireCalculator data={data} snapshots={snapshots} />
        <MilestonesPanel data={data} snapshots={snapshots} />
        <PeopleLedger debts={data.debts} />
        <YearEndReport data={data} snapshots={snapshots} />
        <SearchExport items={searchItems} />
        <StatementArchive data={data} />
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Detay verileri yükleniyor...</p> : null}
    </section>
  )
}
