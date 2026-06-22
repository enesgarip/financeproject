import {
  Search,
  TrendingUp,
} from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../EmptyState'
import { dashboardHelp } from './dashboardPanelUtils'
import { CashFlowMetric } from './DashboardCashFlow'
import { DonutChart, type DonutSlice } from '../charts/DonutChart'
import { AmountDisplay, FinancePanel, MetricCard, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../finance/FinanceUI'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip } from '../ui/help-tooltip'
import { Input } from '../ui/input'
import { Progress } from '../ui/progress'
import type { Card as FinanceCard, TransactionHistory, TransactionHistoryType } from '../../types/database'
import { daysUntil, nextMonthlyDate } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { diffTL } from '../../utils/money'
import { normalizeSearchText } from '../../utils/searchText'
import {
  cardMonthlyPaymentAmount,
  type CashFlowSummary,
  type CreditLimitGroup,
} from '../../utils/financeSummary'

const historyFilters: Array<{ label: string; value: TransactionHistoryType | 'all' }> = [
  { label: 'Tümü', value: 'all' },
  { label: 'Ödeme', value: 'payment' },
  { label: 'Transfer', value: 'transfer' },
  { label: 'Kredi', value: 'loan' },
  { label: 'Borç', value: 'debt' },
  { label: 'Kart', value: 'card' },
]

export function CreditCardSnapshotPanel({
  cards,
  totalDebt,
  statementDebt,
  totalLimit,
  usageRate,
}: {
  cards: FinanceCard[]
  totalDebt: number
  statementDebt: number
  totalLimit: number
  usageRate: number
}) {
  const creditCards = cards.filter((card) => card.card_type === 'kredi_karti')
  const visibleCards = [...creditCards].sort((left, right) => right.debt_amount - left.debt_amount).slice(0, 3)
  const availableLimit = Math.max(0, diffTL(totalLimit, totalDebt))
  const dueSoonCount = creditCards.filter((card) => {
    const remaining = daysUntil(nextMonthlyDate(card.due_day))
    return cardMonthlyPaymentAmount(card) > 0 && remaining !== null && remaining >= 0 && remaining <= 7
  }).length
  const tone = usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Kredi kartları"
        description="Açık ekstre, limit ve yaklaşan son ödeme odağı."
        action={<StatusBadge tone={dueSoonCount > 0 ? 'warning' : 'good'}>{dueSoonCount > 0 ? `${dueSoonCount} yakın vade` : 'Kontrol altında'}</StatusBadge>}
      />
      <div className="mt-5">
        <AmountDisplay label="Toplam kart borcu" value={formatCurrency(totalDebt)} tone={tone} size="lg" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Açık ekstre" value={formatCurrency(statementDebt)} tone={statementDebt > 0 ? 'warning' : 'good'} />
        <MiniStat label="Kullanılabilir" value={formatCurrency(availableLimit)} tone="good" />
      </div>
      <div className="mt-5">
        <ProgressStrip label="Limit kullanımı" value={usageRate} tone={tone} detail={`${creditCards.length} kredi kartı takipte`} />
      </div>
      {visibleCards.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {visibleCards.map((card) => (
            <Link
              key={card.id}
              to="/kartlar?section=kartlar"
              className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg bg-background/65 px-3 py-2.5 ring-1 ring-border/70 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{card.card_name}</p>
                <p className="truncate text-xs text-muted-foreground">{card.bank_name}</p>
              </div>
              <p title={formatCurrency(card.debt_amount)} className="finance-value max-w-[45%] shrink-0 truncate text-sm font-black text-foreground">{formatCurrency(card.debt_amount)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-background/65 p-3 text-sm text-muted-foreground ring-1 ring-border/70">Henüz kredi kartı yok; kart ekleyince ekstre ve limit takibi burada görünür.</p>
      )}
    </FinancePanel>
  )
}

export function AnalyticsSnapshotPanel({
  cashFlow,
  totalAssets,
  totalDebts,
  cardDebt,
  loanDebt,
  personalDebt,
}: {
  cashFlow: CashFlowSummary
  totalAssets: number
  totalDebts: number
  cardDebt: number
  loanDebt: number
  personalDebt: number
}) {
  const assetDebtRatio = totalAssets > 0 ? Math.min(100, (totalDebts / totalAssets) * 100) : totalDebts > 0 ? 100 : 0

  const donutData: DonutSlice[] = [
    ...(cardDebt > 0    ? [{ name: 'Kart',    value: cardDebt,     color: 'var(--warning)' }]     : []),
    ...(loanDebt > 0    ? [{ name: 'Kredi',   value: loanDebt,     color: 'var(--info)' }]         : []),
    ...(personalDebt > 0? [{ name: 'Kişisel', value: personalDebt, color: 'var(--destructive)' }]  : []),
  ]

  return (
    <FinancePanel className="p-4 sm:p-5">
      <SectionHeader title="Analiz kartları" description="Gelir/gider ve borç dağılımını hızlı kontrol et." />
      <div className="mt-4 grid gap-3 min-[720px]:grid-cols-3">
        {/* Net flow card */}
        <MetricCard
          label="Gelir / Gider"
          value={`${cashFlow.netFlow >= 0 ? '+' : ''}${formatCurrency(cashFlow.netFlow)}`}
          description={`Gelir ${formatCurrency(cashFlow.income)} · Çıkış ${formatCurrency(cashFlow.outflow)}`}
          tone={cashFlow.netFlow >= 0 ? 'good' : 'danger'}
          icon={TrendingUp}
          deltaLabel={cashFlow.netFlow >= 0 ? 'up' : 'down'}
          delta={cashFlow.netFlow >= 0 ? 'Pozitif akış' : 'Nakit açığı'}
        />

        {/* Debt donut */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="finance-label mb-3">Borç Dağılımı</p>
          {donutData.length > 0 ? (
            <DonutChart data={donutData} size={176} innerRadius={48} totalLabel="Toplam Borç" />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              Borç kaydı yok
            </div>
          )}
        </div>

        {/* Asset/debt ratio */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <AmountDisplay
            label="Varlık / Borç Baskısı"
            value={`%${Math.round(assetDebtRatio)}`}
            tone={assetDebtRatio >= 80 ? 'danger' : assetDebtRatio >= 45 ? 'warning' : 'good'}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Varlık {formatCurrency(totalAssets)} · Borç {formatCurrency(totalDebts)}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <ProgressStrip label="Borç Baskısı" value={assetDebtRatio} tone={assetDebtRatio >= 80 ? 'danger' : assetDebtRatio >= 45 ? 'warning' : 'good'} />
          </div>
        </div>
      </div>
    </FinancePanel>
  )
}

export function CurrentDebtTotalsPanel({
  totalDebt,
  cardDebt,
  loanDebt,
  personalDebt,
  paymentDebt,
}: {
  totalDebt: number
  cardDebt: number
  loanDebt: number
  personalDebt: number
  paymentDebt: number
}) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="inline-flex items-center gap-1.5">
          Güncel borç toplamları
          <HelpTooltip title="Güncel borç toplamları" content={dashboardHelp.currentDebt} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 pt-0">
        <CashFlowMetric label="Toplam borç" value={formatCurrency(totalDebt)} tone="rose" />
        <CashFlowMetric label="Kart borcu" value={formatCurrency(cardDebt)} tone="rose" />
        <CashFlowMetric label="Kredi borcu" value={formatCurrency(loanDebt)} tone="rose" />
        <CashFlowMetric label="Kişisel borç" value={formatCurrency(personalDebt)} tone="rose" />
        <CashFlowMetric label="Fatura/ödeme" value={formatCurrency(paymentDebt)} tone="rose" />
      </CardContent>
    </Card>
  )
}

export function CreditLimitSection({ groups, totalUsageRate }: { groups: CreditLimitGroup[]; totalUsageRate: number }) {
  if (groups.length === 0) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="inline-flex items-center gap-1.5">
            Kart limitleri
            <HelpTooltip title="Kart limitleri" content={dashboardHelp.creditLimit} />
          </CardTitle>
          <Badge variant="secondary">%{Math.round(totalUsageRate)} kullanım</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-1">
        {groups.slice(0, 3).map((group) => (
          <div key={group.key} className="rounded-lg bg-muted/55 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{group.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {group.cards.length} kart · kalan {formatCurrency(group.available)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-extrabold tabular-nums text-foreground">{formatCurrency(group.debt)}</p>
            </div>
            <Progress value={group.usageRate} className="mt-3 h-1.5" aria-label={`${group.label} limit kullanımı %${Math.round(group.usageRate)}`} />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>Limit {formatCurrency(group.limit)}</span>
              <span>%{Math.round(group.usageRate)}</span>
            </div>
          </div>
        ))}
        {groups.length > 3 ? (
          <p className="rounded-lg bg-muted/45 px-3 py-2 text-xs font-semibold text-muted-foreground">
            +{groups.length - 3} limit grubu daha kartlar ekranında.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function HistorySection({ rows }: { rows: TransactionHistory[] }) {
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
                          <span title={formatCurrency(row.amount)} className="finance-value max-w-[45%] shrink-0 truncate rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
                            {formatCurrency(row.amount)}
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
