import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, CreditCard, Landmark, Minus, Receipt, RefreshCw, Repeat } from 'lucide-react'
import { formatDate } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import {
  buildActivityFeed,
  groupByDate,
  type ActivityFilter,
  type ActivityItem,
} from '../utils/activityFeed'
import { fetchRecentAccountLedgerEvents, fetchRecentCardLedgerEvents } from '../data/repositories/financePanelsRepo'
import type { AnalysisData } from '../utils/analysisView'
import { cn } from '../lib/utils'

const ICON_MAP: Record<ActivityItem['icon'], typeof CreditCard> = {
  card: CreditCard,
  account: Landmark,
  payment: Receipt,
  transfer: Repeat,
  loan: ArrowDownCircle,
  debt: ArrowUpCircle,
}

const FILTER_OPTIONS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'card_ledger', label: 'Kart borcu' },
  { value: 'account_ledger', label: 'Hesap' },
  { value: 'transaction_history', label: 'İşlemler' },
]

const PAGE_SIZE = 30

export function ActivityFeedPanel({ data }: { data: AnalysisData }) {
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [cardLedger, setCardLedger] = useState<Awaited<ReturnType<typeof fetchRecentCardLedgerEvents>> | null>(null)
  const [accountLedger, setAccountLedger] = useState<Awaited<ReturnType<typeof fetchRecentAccountLedgerEvents>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const loadLedgers = useCallback(async () => {
    setLoading(true)
    const [cl, al] = await Promise.all([
      fetchRecentCardLedgerEvents(200),
      fetchRecentAccountLedgerEvents(200),
    ])
    setCardLedger(cl)
    setAccountLedger(al)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLedgers()
  }, [loadLedgers])

  const allItems = useMemo(() => {
    const cl = cardLedger?.ok ? cardLedger.data : []
    const al = accountLedger?.ok ? accountLedger.data : []
    return buildActivityFeed(cl, al, data.transactionHistory, data.cards, filter)
  }, [cardLedger, accountLedger, data.transactionHistory, data.cards, filter])

  const visibleItems = useMemo(() => allItems.slice(0, visibleCount), [allItems, visibleCount])
  const grouped = useMemo(() => groupByDate(visibleItems), [visibleItems])

  return (
    <div className="col-span-full rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">Aktivite Akışı</h3>
        <button
          type="button"
          onClick={() => void loadLedgers()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition"
          title="Yenile"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="mb-3 flex gap-1.5 overflow-x-auto finance-scrollbar">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { setFilter(opt.value); setVisibleCount(PAGE_SIZE) }}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-bold transition',
              filter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Henüz kayıt yok.</p>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([date, items]) => (
            <div key={date}>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {formatDate(date)}
              </p>
              <div className="space-y-1">
                {items.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}

          {visibleCount < allItems.length ? (
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="w-full rounded-lg border border-border/50 py-2 text-xs font-bold text-muted-foreground hover:bg-muted/40 transition"
            >
              Daha fazla göster ({allItems.length - visibleCount} kayıt)
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { formatAmount } = useBalancePrivacy()
  const Icon = ICON_MAP[item.icon] ?? Minus
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/40 transition">
      <div className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full',
        item.direction === 'inflow' ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' :
        item.direction === 'outflow' ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400' :
        'bg-muted text-muted-foreground',
      )}>
        <Icon size={14} strokeWidth={2.2} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground">{item.title}</p>
        {item.detail ? (
          <p className="truncate text-[10px] text-muted-foreground">{item.detail}</p>
        ) : null}
      </div>

      {item.amountTL != null ? (
        <span className={cn(
          'shrink-0 text-xs font-bold tabular-nums',
          item.direction === 'inflow' ? 'text-emerald-600 dark:text-emerald-400' :
          item.direction === 'outflow' ? 'text-rose-600 dark:text-rose-400' :
          'text-muted-foreground',
        )}>
          {item.direction === 'inflow' ? '+' : item.direction === 'outflow' ? '−' : ''}
          {formatAmount(Math.abs(item.amountTL))}
        </span>
      ) : null}
    </div>
  )
}
