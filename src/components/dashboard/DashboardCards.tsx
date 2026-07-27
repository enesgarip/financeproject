import { Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { EmptyState } from '../EmptyState'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import type { TransactionHistory, TransactionHistoryType } from '../../types/database'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { normalizeSearchText } from '../../utils/searchText'

const historyFilters: Array<{ label: string; value: TransactionHistoryType | 'all' }> = [
  { label: 'Tümü', value: 'all' },
  { label: 'Ödeme', value: 'payment' },
  { label: 'Transfer', value: 'transfer' },
  { label: 'Kredi', value: 'loan' },
  { label: 'Borç', value: 'debt' },
  { label: 'Kart', value: 'card' },
  { label: 'Düzeltme', value: 'correction' },
  { label: 'Varlık', value: 'asset' },
]

export function HistorySection({ rows }: { rows: TransactionHistory[] }) {
  const { formatAmount } = useBalancePrivacy()
  const [activeType, setActiveType] = useState<TransactionHistoryType | 'all'>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const normalizedQuery = normalizeSearchText(deferredQuery)
  const filteredRows = useMemo(
    () => (activeType === 'all' ? rows : rows.filter((row) => row.type === activeType)).filter((row) =>
      normalizedQuery ? normalizeSearchText(`${row.title} ${row.note ?? ''} ${row.type}`).includes(normalizedQuery) : true,
    ),
    [rows, activeType, normalizedQuery],
  )
  const groupedRows = useMemo(() => groupHistoryRows(filteredRows.slice(0, 40)), [filteredRows])

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Son güncellemeler</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Son 3 ay işlem geçmişi ve hesap hareketleri.</p>
          </div>
          <Badge variant="secondary">{filteredRows.length} kayıt</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Geçmiş işlemlerde ara"
            placeholder="Geçmişte ara"
            className="pl-9 text-sm"
          />
        </label>
        <div className="finance-scrollbar flex gap-2 overflow-x-auto pb-1">
          {historyFilters.map((filter) => {
            const isActive = activeType === filter.value

            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveType(filter.value)}
                className={`min-h-11 shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
      {rows.length === 0 ? (
        <EmptyState title="İşlem geçmişi yok" description="Planlı ödemeler, transferler ve borç kapatma işlemleri burada görünecek." />
      ) : filteredRows.length === 0 ? (
        <EmptyState title="Bu filtrede işlem yok" description="Farklı bir işlem türü seçerek geçmiş kayıtları görebilirsiniz." />
      ) : (
        <div className="space-y-5">
          {groupedRows.map((group) => (
            <section key={group.label} className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="shrink-0 text-xs font-bold uppercase text-muted-foreground">{group.label}</h3>
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
              </div>
              <div className="space-y-2">
                {group.rows.map((row) => (
                  <article key={row.id} className="flex gap-3 rounded-lg border border-border/75 bg-card/80 p-3 shadow-sm">
                    <div className={`mt-1 size-2.5 shrink-0 rounded-full ${historyDotClass(row.type)}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{row.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatHistoryDate(row.occurred_at)}</p>
                        </div>
                        {row.amount !== null ? (
                          <span title={formatAmount(row.amount)} className="finance-value max-w-[45%] shrink-0 truncate rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
                            {formatAmount(row.amount)}
                          </span>
                        ) : null}
                      </div>
                      {row.note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.note}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  )
}

function groupHistoryRows(rows: TransactionHistory[]) {
  const groups = new Map<string, TransactionHistory[]>()

  for (const row of rows) {
    const label = formatHistoryDay(row.occurred_at)
    groups.set(label, [...(groups.get(label) ?? []), row])
  }

  return Array.from(groups, ([label, groupRows]) => ({ label, rows: groupRows }))
}

function formatHistoryDay(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toLocaleDateString('sv-SE') === today.toLocaleDateString('sv-SE')) return 'Bugün'
  if (date.toLocaleDateString('sv-SE') === yesterday.toLocaleDateString('sv-SE')) return 'Dün'

  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function historyDotClass(type: TransactionHistoryType) {
  const classes: Record<TransactionHistoryType, string> = {
    payment: 'bg-amber-500',
    transfer: 'bg-sky-500',
    loan: 'bg-rose-500',
    debt: 'bg-violet-500',
    card: 'bg-emerald-500',
    correction: 'bg-stone-500',
    asset: 'bg-teal-500',
  }

  return classes[type]
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
