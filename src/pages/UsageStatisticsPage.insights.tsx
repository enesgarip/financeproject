import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { usageActions, usageSources, type UsageDays, type UsageInsights } from '../utils/usageStatistics'

const number = new Intl.NumberFormat('tr-TR')
const change = new Intl.NumberFormat('tr-TR', { signDisplay: 'exceptZero' })

export function UsagePeriodComparison({ data, days }: { data: UsageInsights; days: UsageDays }) {
  const metrics = [
    ['Aktif gün', 'active_days'],
    ['Sayfa açılışı', 'page_views'],
    ['Tamamlanan işlem', 'completed'],
    ['Hata yanıtı', 'failed'],
  ] as const
  const hasPrevious = data.previous.active_days > 0
  return (
    <Card>
      <CardHeader><CardTitle><h2>Dönem karşılaştırması</h2></CardTitle></CardHeader>
      <CardContent>
        <table className="w-full table-fixed text-left text-sm">
          <thead className="text-xs text-ink-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 font-semibold">Ölçüm</th>
              <th scope="col" className="w-14 py-2 text-right font-semibold">Son {days} gün</th>
              <th scope="col" className="w-14 py-2 text-right font-semibold">Önceki {days} gün</th>
              <th scope="col" className="w-12 py-2 text-right font-semibold">Fark</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map(([label, key]) => (
              <tr key={key} className="border-b border-line last:border-0">
                <th scope="row" className="break-words py-2.5 pr-1 font-medium">{label}</th>
                <td className="text-right tabular-nums">{number.format(data.comparison[key])}</td>
                <td className="text-right tabular-nums text-ink-muted">{hasPrevious ? number.format(data.previous[key]) : '—'}</td>
                <td className="text-right tabular-nums">{hasPrevious ? change.format(data.comparison[key] - data.previous[key]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!hasPrevious ? <p className="mt-2 text-xs text-ink-muted">Önceki dönemde kullanım kaydı yok.</p> : null}
      </CardContent>
    </Card>
  )
}

function MetricValues({ metrics }: { metrics: readonly (readonly [string, number])[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd className="text-base font-semibold tabular-nums">{number.format(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function UsageInsightsPanels({ data }: { data: UsageInsights }) {
  const { automation } = data
  const flows = data.flows.toSorted((a, b) => b.opened - a.opened || a.subject.localeCompare(b.subject))
  return (
    <>
      <Card>
        <CardHeader><CardTitle><h2>İşlem akışları</h2></CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-ink-muted">Bu dönemde açılan formların gözlemlenen adımları. Tamamlanma, açılan form başına bir kez sayılır.</p>
          {flows.length === 0 ? <p className="text-sm text-ink-muted">Bu dönemde eşleştirilmiş akış kaydı yok.</p> : (
            <ul className="divide-y divide-line">
              {flows.map(flow => (
                <li key={flow.subject} className="space-y-2 py-3">
                  <h3 className="text-sm font-semibold">{usageActions[flow.subject].label}</h3>
                  <MetricValues metrics={flow.subject === 'purchase' ? [
                    ['Açıldı', flow.opened],
                    ['Sonuç gösterildi', flow.completed],
                    ['Sonuç almadan kapandı', flow.closed_before_submit],
                  ] : [
                    ['Açıldı', flow.opened],
                    ['Kaydetme denendi', flow.submitted],
                    ['Tamamlandı', flow.completed],
                    ['Kaydetmeden kapandı', flow.closed_before_submit],
                    ['Hata aldı, tamamlanmadı', flow.failed],
                    ['Hata sonrası tamamlandı', flow.recovered],
                  ]} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><h2>İşlemler nereden başlatıldı?</h2></CardTitle></CardHeader>
        <CardContent>
          {data.sources.length === 0 ? <p className="text-sm text-ink-muted">Bu dönemde başlangıç noktası kaydı yok.</p> : (
            <ul className="divide-y divide-line">
              {Object.entries(usageActions).map(([subject, action]) => {
                const entries = data.sources.filter(row => row.subject === subject)
                  .toSorted((a, b) => b.event_count - a.event_count || a.source.localeCompare(b.source))
                if (entries.length === 0) return null
                return (
                  <li key={subject} className="py-3">
                    <h3 className="mb-1 text-sm font-semibold">{action.label}</h3>
                    <dl className="space-y-1 text-sm">
                      {entries.map(row => (
                        <div key={row.source} className="flex justify-between gap-3">
                          <dt className="text-ink-muted">{usageSources[row.source]}</dt>
                          <dd className="tabular-nums">{number.format(row.event_count)}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><h2>SMS otomasyonu</h2></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <section aria-label="Seçili dönemde SMS işleme" className="space-y-2">
            <h3 className="text-sm font-semibold">Seçili dönem</h3>
            <MetricValues metrics={[
              ['Başarılı kart SMS yanıtı', automation.card_sms],
              ['Başarılı hesap SMS yanıtı', automation.account_sms],
              ['SMS hata yanıtı', automation.sms_errors],
              ['Elle tamamlanan dövizli SMS', automation.foreign_completed],
            ]} />
          </section>
          <section aria-label="Güncel SMS bekleme listesi" className="space-y-2 border-t border-line pt-3">
            <h3 className="text-sm font-semibold">Şu anda bekleyenler</h3>
            <MetricValues metrics={[
              ['TL karşılığı bekleyen', automation.foreign_pending],
              ['En az 24 saattir bekleyen', automation.foreign_pending_over_day],
            ]} />
          </section>
        </CardContent>
      </Card>
    </>
  )
}
