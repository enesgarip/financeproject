import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { routeTitle, usagePagePaths } from '../components/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { QueryError } from '../components/ui/query-error'
import { appFeatures } from '../utils/featureDiscovery'
import { usageActions, usageTabs, type UsageDays, type UsageInsights, type UsageSummaryRow } from '../utils/usageStatistics'
import { UsageInsightsPanels, UsagePeriodComparison } from './UsageStatisticsPage.insights'

const periods = [7, 30] as const
const countFormat = new Intl.NumberFormat('tr-TR')

type CountRow = { id: string; label: string; count: number; days: number; previous: number }

function rankedRows(rows: CountRow[]) {
  return rows.toSorted((a, b) => b.count - a.count || b.days - a.days || a.label.localeCompare(b.label, 'tr'))
}

function Counts({ rows, showPrevious }: { rows: CountRow[]; showPrevious: boolean }) {
  return (
    <table className="w-full table-fixed text-left text-sm">
      <thead className="text-xs text-ink-muted">
        <tr className="border-b border-line">
          <th scope="col" className="py-2 font-semibold">Ad</th>
          <th scope="col" className="w-16 py-2 text-right font-semibold">Açılış</th>
          <th scope="col" className="w-12 py-2 text-right font-semibold">Gün</th>
          {showPrevious ? <th scope="col" className="w-14 py-2 text-right font-semibold">Önceki</th> : null}
        </tr>
      </thead>
      <tbody>
        {rankedRows(rows).map(row => (
          <tr key={row.id} className="border-b border-line last:border-0">
            <th scope="row" className="break-words py-2.5 pr-2 font-medium">{row.label}</th>
            <td className="py-2.5 text-right tabular-nums">{countFormat.format(row.count)}</td>
            <td className="py-2.5 text-right tabular-nums text-ink-muted">{countFormat.format(row.days)}</td>
            {showPrevious ? <td className="py-2.5 text-right tabular-nums text-ink-muted">{countFormat.format(row.previous)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function UsageResults({ data }: { data: UsageInsights }) {
  const summary = new Map(data.rows.map(row => [`${row.kind}:${row.subject}`, row]))
  const count = (kind: UsageSummaryRow['kind'], subject: string) => summary.get(`${kind}:${subject}`)?.event_count ?? 0
  const days = (kind: UsageSummaryRow['kind'], subject: string) => summary.get(`${kind}:${subject}`)?.active_days ?? 0
  const showPrevious = data.previous.active_days > 0
  function toCountRow(kind: 'page' | 'tab' | 'discovery', id: string, label: string): CountRow {
    return { id, label, count: count(kind, id), days: days(kind, id), previous: summary.get(`${kind}:${id}`)?.previous_count ?? 0 }
  }
  const screenRows: CountRow[] = [
    ...usagePagePaths.map(path => toCountRow('page', path, routeTitle(path))),
    ...Object.entries(usageTabs).map(([id, label]) => toCountRow('tab', id, label)),
  ]
  const openedScreens = screenRows.filter(row => row.count > 0 || row.previous > 0)
  const unusedScreens = screenRows.filter(row => row.count === 0 && row.previous === 0)
  const discoveryRows = appFeatures.map(({ id, title }) => toCountRow('discovery', id, title))
    .filter(row => row.count > 0 || row.previous > 0)

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle><h2>Sayfalar ve sekmeler</h2></CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {openedScreens.length > 0 ? <Counts rows={openedScreens} showPrevious={showPrevious} /> : <p className="text-sm text-ink-muted">Bu dönemde açılış kaydı yok.</p>}
          {unusedScreens.length > 0 ? (
            <details className="rounded-lg border border-line px-3">
              <summary className="cursor-pointer py-3 text-sm font-semibold">
                Açılış kaydı olmayanlar ({unusedScreens.length})
              </summary>
              <Counts rows={unusedScreens} showPrevious={showPrevious} />
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><h2>İşlemler</h2></CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-line">
            {Object.entries(usageActions).map(([id, action]) => {
              const metrics = [
                ['Açılış', action.opens ? count('opened', id) : null],
                ['Deneme', action.submits ? count('attempted', id) : null],
                ['Tamamlanan', count('completed', id)],
                ['Hata', action.submits ? count('failed', id) : null],
                ['Başarılı gün', days('completed', id)],
              ] as const
              return (
                <li key={id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_2fr] sm:items-center">
                  <h3 className="text-sm font-semibold">{action.label}</h3>
                  <dl className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-5 sm:text-center">
                    {metrics.map(([label, value]) => (
                      <div key={label}>
                        <dt className="break-words text-ink-muted">{label}</dt>
                        <dd className="text-sm font-semibold tabular-nums">{value === null ? '—' : countFormat.format(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle><h2>Ara ve keşfet</h2></CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-ink-muted">Sonuç bulunamayan aramalar <strong className="text-ink">{countFormat.format(count('no_results', 'search'))}</strong></p>
          {discoveryRows.length > 0 ? <Counts rows={discoveryRows} showPrevious={showPrevious} /> : <p className="text-sm text-ink-muted">Bu dönemde keşiften açılan özellik yok.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

export function UsageStatisticsPage() {
  const { user } = useAuth()
  const [days, setDays] = useState<UsageDays>(30)
  const usage = useQuery({
    queryKey: ['usage-summary', user?.id, days],
    enabled: Boolean(user),
    queryFn: async () => {
      const { fetchUsageInsights } = await import('../data/repositories/usageStatisticsRepo')
      const result = await fetchUsageInsights(days)
      if (!result.ok) throw new Error(result.error.message)
      if (!result.data) throw new Error('Kullanım istatistikleri için oturumu yenile.')
      return result.data
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Gün sayıları İstanbul saatine göre hesaplanır.</p>
        <div className="flex gap-2" role="group" aria-label="İstatistik dönemi">
          {periods.map(period => (
            <button
              key={period}
              type="button"
              aria-pressed={period === days}
              onClick={() => setDays(period)}
              className="min-h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
            >
              Son {period} gün
            </button>
          ))}
        </div>
      </div>
      {usage.isPending ? <p role="status" className="text-sm text-ink-muted">Kullanım istatistikleri yükleniyor…</p> : null}
      {usage.isError ? <QueryError title="Kullanım istatistikleri yüklenemedi" message={usage.error.message} retrying={usage.isFetching} onRetry={() => void usage.refetch()} /> : null}
      {usage.data ? <>
        <UsagePeriodComparison data={usage.data} days={days} />
        <UsageInsightsPanels data={usage.data} />
        {usage.data.rows.length > 0
          ? <UsageResults data={usage.data} />
          : <p className="rounded-xl border border-line-strong bg-raised p-4 text-sm text-ink-muted">Henüz kullanım kaydı yok. Uygulamayı kullandıkça istatistiklerin burada görünecek.</p>}
      </> : null}
    </div>
  )
}
