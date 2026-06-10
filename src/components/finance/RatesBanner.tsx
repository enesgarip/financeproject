import { RefreshCw, TrendingUp, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useMarketRates } from '../../hooks/useMarketRates'
import { syncAutoValuedRows } from '../../utils/valuationSync'

function formatAsOf(iso: string | null): string {
  if (!iso) return 'bilinmiyor'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'bilinmiyor'
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * Live FX/gold rate status strip shown above auto-valued lists.
 *
 * Beyond display, it keeps stored TRY values in sync: whenever the snapshot
 * changes (initial load or a manual refresh) it recomputes the user's
 * auto-valued rows and, when something actually changed, asks the host page to
 * reload via `onSynced`.
 */
export function RatesBanner({ onSynced, note }: { onSynced?: () => void | Promise<void>; note?: string }) {
  const { asOf, loading, error, source, isStale, snapshot, refresh } = useMarketRates()

  const onSyncedRef = useRef(onSynced)
  const lastSyncedRef = useRef<string | null>(null)

  useEffect(() => {
    onSyncedRef.current = onSynced
  }, [onSynced])

  useEffect(() => {
    if (!snapshot) return
    const key = snapshot.asOf ?? snapshot.fetchedAt
    if (lastSyncedRef.current === key) return
    lastSyncedRef.current = key
    void syncAutoValuedRows(snapshot).then((result) => {
      if (result.updated > 0) void onSyncedRef.current?.()
    })
  }, [snapshot])

  const offline = source === 'cache' || isStale
  const noData = !snapshot

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-xl ${
            offline || noData ? 'bg-warning/12 text-warning' : 'bg-success/12 text-success'
          }`}
        >
          {offline || noData ? <TriangleAlert className="size-4" /> : <TrendingUp className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Canlı altın & döviz kuru</p>
          <p className="truncate text-xs text-muted-foreground">
            {noData
              ? 'Kur verisi henüz yüklenmedi'
              : `truncgil.com · ${formatAsOf(asOf)} itibarıyla${source === 'cache' ? ' · çevrimdışı kopya' : ''}${
                  isStale && source !== 'cache' ? ' · güncel olmayabilir' : ''
                }`}
          </p>
          {note ? <p className="truncate text-xs text-muted-foreground/80">{note}</p> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={loading}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted active:scale-[0.97] disabled:opacity-50"
        aria-label="Kurları yenile"
      >
        <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Yenileniyor' : 'Yenile'}
      </button>
      {error && !snapshot ? <span className="sr-only">{error}</span> : null}
    </div>
  )
}
