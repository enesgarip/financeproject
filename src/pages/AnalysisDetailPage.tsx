import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { InflationShieldPanel, ZakatPanel } from './AnalysisPage.wealth'
import { SearchExport, YearEndReport } from './AnalysisPage.reports'
import { PeopleLedger } from './AnalysisPage.panels'
import { ActivityFeedPanel } from './AnalysisPage.activity'
import { useAnalysisPageData } from './AnalysisPage.data'
import { PageCommandHeader } from '../components/finance/FinanceUI'

/**
 * Yılda bir bakılan paneller (zekât, yıl sonu özeti) katlanır durur: sayfayı
 * her açılışta uzatmasınlar ama silinmesinler de.
 */
function CollapsibleSection({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="lg:col-span-12">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/80 px-4 py-3 text-sm font-bold text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
      >
        <span>{open ? `${label} — gizle` : label}</span>
        <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-12">{children}</div> : null}
    </div>
  )
}

export function AnalysisDetailPage() {
  const { data, error, loading, ratesSnapshot, searchItems, snapshots } = useAnalysisPageData()

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="min-w-0 space-y-5">
      <PageCommandHeader
        label="Derin analiz"
        title="Servet, kayıt ve dönemsel görünüm"
        description="Aktivite geçmişini, kişi bakiyelerini, enflasyon etkisini ve uzun dönem raporlarını incele."
        meta={loading ? 'Detaylar güncelleniyor' : 'Denetlenebilir finans geçmişi'}
      />
      <div className="grid min-w-0 gap-5 lg:grid-cols-12 [&>*]:min-w-0">
        <InflationShieldPanel data={data} />
        <PeopleLedger debts={data.debts} />
        <ActivityFeedPanel data={data} />
        <SearchExport items={searchItems} />

        <CollapsibleSection label="Yıl sonu özeti">
          <YearEndReport data={data} snapshots={snapshots} />
        </CollapsibleSection>

        <CollapsibleSection label="Zekât hesaplayıcı">
          <ZakatPanel data={data} ratesSnapshot={ratesSnapshot} />
        </CollapsibleSection>
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Detay verileri yükleniyor...</p> : null}
    </section>
  )
}
