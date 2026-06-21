import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { dashboardHelp } from './dashboardPanelUtils'
import { CashFlowChart, type CashFlowPoint } from '../charts/CashFlowChart'
import { AmountDisplay, FinancePanel, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../finance/FinanceUI'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip } from '../ui/help-tooltip'
import { Progress } from '../ui/progress'
import type { DashboardUpcomingItem } from '../../utils/dashboardUpcoming'
import { formatDate } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { diffTL, sumTL } from '../../utils/money'
import {
  sum,
  type CashFlowSummary,
} from '../../utils/financeSummary'

type UpcomingItem = DashboardUpcomingItem

const UPCOMING_DAYS = 30

export function CashFlowMetric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'

  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2 min-[430px]:px-3">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-[clamp(0.7rem,3vw,1rem)] font-extrabold leading-tight tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  )
}

export function MonthlyPaymentLoadPanel({
  cashFlow,
  nextMonthOutflow,
  upcomingTotal,
  upcomingCount,
}: {
  cashFlow: CashFlowSummary
  nextMonthOutflow: number
  upcomingTotal: number
  upcomingCount: number
}) {
  const loadRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : cashFlow.outflow > 0 ? 100 : 0
  const tone = loadRate >= 90 ? 'danger' : loadRate >= 65 ? 'warning' : 'good'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Bu ay ödeme yükü"
        description="Kart, kredi, fatura ve kişisel borç baskısı."
        action={<StatusBadge tone={tone}>{upcomingCount > 0 ? `${upcomingCount} vade` : 'Takvim temiz'}</StatusBadge>}
      />
      <div className="mt-5">
        <AmountDisplay label={cashFlow.monthLabel} value={formatCurrency(cashFlow.outflow)} tone={tone} size="lg" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Yaklaşan toplam" value={upcomingCount > 0 ? formatCurrency(upcomingTotal) : 'Yok'} tone={upcomingCount > 0 ? 'warning' : 'good'} />
        <MiniStat label="Gelecek ay" value={formatCurrency(nextMonthOutflow)} tone={nextMonthOutflow > cashFlow.outflow ? 'warning' : 'neutral'} />
      </div>
      <div className="mt-5">
        <ProgressStrip label="Gelire göre çıkış" value={loadRate} tone={tone} />
      </div>
    </FinancePanel>
  )
}

export function CashFlowPanel({ cashFlow }: { cashFlow: CashFlowSummary }) {
  const outflowRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : 0
  const isPositive = cashFlow.netFlow >= 0

  // Build chart data from cashFlow breakdown
  const chartData: CashFlowPoint[] = cashFlow.income > 0 || cashFlow.outflow > 0 ? [
    {
      label: 'Gelir',
      income: cashFlow.income,
      outflow: 0,
      net: cashFlow.income,
    },
    {
      label: 'Kart',
      income: 0,
      outflow: cashFlow.cardOutflow,
      net: -cashFlow.cardOutflow,
    },
    {
      label: 'Kredi',
      income: 0,
      outflow: cashFlow.loanOutflow,
      net: -cashFlow.loanOutflow,
    },
    {
      label: 'Fatura',
      income: 0,
      outflow: cashFlow.paymentOutflow,
      net: -cashFlow.paymentOutflow,
    },
    {
      label: 'Net',
      income: Math.max(0, cashFlow.netFlow),
      outflow: Math.max(0, -cashFlow.netFlow),
      net: cashFlow.netFlow,
    },
  ] : []

  return (
    <Card variant="default" className="border-border/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="inline-flex items-center gap-1.5">
              Aylık nakit akışı
              <HelpTooltip title="Aylık nakit akışı" content={dashboardHelp.cashFlow} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{cashFlow.monthLabel}</p>
          </div>
          <Badge variant={isPositive ? 'success' : 'destructive'}>
            {isPositive ? 'Artıda' : 'Açık var'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {/* Summary pills */}
        <div className="grid grid-cols-3 gap-2">
          <CashFlowMetric label="Gelir" value={formatCurrency(cashFlow.income)} tone="emerald" />
          <CashFlowMetric label="Çıkış" value={formatCurrency(cashFlow.outflow)} tone="rose" />
          <CashFlowMetric label="Ay sonu" value={formatCurrency(cashFlow.projectedCash)} tone={cashFlow.projectedCash >= 0 ? 'emerald' : 'rose'} />
        </div>

        {/* Area chart */}
        {chartData.length > 0 && (
          <div className="rounded-xl bg-muted/20 p-2">
            <CashFlowChart data={chartData} height={180} />
          </div>
        )}

        {/* Outflow rate */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Gelire göre çıkış</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">%{Math.round(outflowRate)}</span>
          </div>
          <Progress value={outflowRate} autoColor size="default" />
        </div>

        {/* Detail grid */}
        <div className="grid gap-1.5 text-xs text-muted-foreground min-[430px]:grid-cols-2">
          <span>🏦 Kart: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.cardOutflow)}</span></span>
          <span>📋 Kredi: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.loanOutflow)}</span></span>
          <span>🧾 Fatura: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.paymentOutflow)}</span></span>
          <span>👤 Kişisel: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.debtOutflow)}</span></span>
          <span>Maaş: <span className="font-mono font-medium text-success">{formatCurrency(cashFlow.salaryIncome)}</span></span>
          {cashFlow.receivableIncome > 0 ? (
            <span>📥 Tahsilat: <span className="font-mono font-medium text-success">{formatCurrency(cashFlow.receivableIncome)}</span></span>
          ) : null}
        </div>

        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
          <p className="text-xs text-muted-foreground">
            Hesap nakdi {formatCurrency(cashFlow.cashAssets)} · {cashFlow.recurringPayments} aylık ödeme
          </p>
          <p className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${isPositive ? 'text-success' : 'text-destructive'}`}>
            Net akış: {cashFlow.netFlow >= 0 ? '+' : ''}{formatCurrency(cashFlow.netFlow)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

type CashFlowCalendarGroup = {
  dayKey: string
  dateLabel: string
  amount: number
  cashImpactAmount: number
  cardSettledAmount: number
  count: number
  kinds: Set<UpcomingItem['kind']>
  cashAfter: number
  items: UpcomingItem[]
}

function buildCashFlowCalendarGroups(items: UpcomingItem[], startingCash: number): CashFlowCalendarGroup[] {
  const groups = new Map<string, Omit<CashFlowCalendarGroup, 'cashAfter'>>()

  for (const item of items) {
    const dayKey = new Date(item.sortTime).toLocaleDateString('sv-SE')
    const current = groups.get(dayKey)
    const nextItems = [...(current?.items ?? []), item]
    groups.set(dayKey, {
      dayKey,
      dateLabel: formatDate(dayKey),
      amount: sumTL([current?.amount, item.amount]),
      cashImpactAmount: sumTL([current?.cashImpactAmount, item.cashImpactAmount]),
      cardSettledAmount: sumTL([current?.cardSettledAmount, item.settlement === 'credit_card' ? item.amount : 0]),
      count: nextItems.length,
      kinds: new Set([...(current?.kinds ?? []), item.kind]),
      items: nextItems,
    })
  }

  let runningCash = startingCash
  return Array.from(groups.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((group) => {
      runningCash = diffTL(runningCash, group.cashImpactAmount)
      return { ...group, cashAfter: runningCash }
    })
}

function kindLabel(kind: UpcomingItem['kind']) {
  if (kind === 'payment') return 'Ödeme'
  if (kind === 'card') return 'Kart'
  if (kind === 'loan') return 'Kredi'
  return 'Borç'
}

export function CashFlowCalendarPanel({ items, cashFlow }: { items: UpcomingItem[]; cashFlow: CashFlowSummary }) {
  const [showAll, setShowAll] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const groups = useMemo(() => buildCashFlowCalendarGroups(items, cashFlow.cashAssets), [cashFlow.cashAssets, items])
  const visibleGroups = showAll ? groups : groups.slice(0, 4)
  const selectedGroup = visibleGroups.find((group) => group.dayKey === selectedDayKey) ?? visibleGroups[0] ?? null
  const totalUpcoming = sum(items, (item) => item.amount)
  const totalCashImpact = sum(items, (item) => item.cashImpactAmount)
  const totalCardSettled = Math.max(0, diffTL(totalUpcoming, totalCashImpact))
  const lowestCash = groups.reduce((lowest, group) => Math.min(lowest, group.cashAfter), cashFlow.cashAssets)

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Nakit takvimi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Önümüzdeki {UPCOMING_DAYS} gün için günlük ödeme yoğunluğu.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={lowestCash < 0 ? 'destructive' : 'secondary'}>
              {groups.length > 0 ? `${groups.length} gün · nakit ${formatCurrency(totalCashImpact)}` : 'Takvim temiz'}
            </Badge>
            {totalCardSettled > 0 ? <Badge variant="info">Kart {formatCurrency(totalCardSettled)}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {groups.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-success/10 px-3 py-3 text-sm text-success">
            <CheckCircle2 className="size-5 shrink-0" />
            <span>Yaklaşan ödeme yok; bu dönem nakit takvimi sakin görünüyor.</span>
          </div>
        ) : (
          <>
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleGroups.map((group) => {
                const cashTone = group.cashAfter < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                const cashBadgeClass = group.cashImpactAmount > 0
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                const isSelected = selectedGroup?.dayKey === group.dayKey

                return (
                  <button
                    key={group.dayKey}
                    type="button"
                    onClick={() => setSelectedDayKey(group.dayKey)}
                    aria-pressed={isSelected}
                    className={`rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200 dark:border-emerald-900/80 dark:bg-emerald-950/25 dark:ring-emerald-900/70'
                        : 'border-border bg-card/70 hover:bg-muted/45'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-foreground">{group.dateLabel}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {Array.from(group.kinds).map(kindLabel).join(' · ')} · {group.count} kayıt
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded-lg px-2 py-1 text-xs font-black tabular-nums ${cashBadgeClass}`}>
                          {group.cashImpactAmount > 0 ? `Nakit ${formatCurrency(group.cashImpactAmount)}` : 'Nakit etkisi yok'}
                        </span>
                        {group.cardSettledAmount > 0 ? (
                          <span className="rounded-lg bg-info/10 px-2 py-1 text-[11px] font-black tabular-nums text-info">
                            Kart {formatCurrency(group.cardSettledAmount)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className={`mt-3 text-xs font-bold tabular-nums ${cashTone}`}>Bu gün sonrası tahmini nakit: {formatCurrency(group.cashAfter)}</p>
                  </button>
                )
              })}
            </div>
            {selectedGroup ? (
              <div className="rounded-lg border border-primary/15 bg-primary/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-emerald-950 dark:text-emerald-50">{selectedGroup.dateLabel}</p>
                    <p className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
                      {selectedGroup.count} kayıt · nakit etkisi {formatCurrency(selectedGroup.cashImpactAmount)}
                      {selectedGroup.cardSettledAmount > 0 ? ` · kart ${formatCurrency(selectedGroup.cardSettledAmount)}` : ''}
                    </p>
                  </div>
                  <Badge variant={selectedGroup.cashAfter < 0 ? 'destructive' : 'secondary'}>
                    Sonra {formatCurrency(selectedGroup.cashAfter)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedGroup.items.map((item) => (
                    <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-card/80 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{item.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.settlement === 'credit_card' ? 'Karttan işlenecek' : kindLabel(item.kind)}
                          {item.subtitle ? ` · ${item.subtitle}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`whitespace-nowrap rounded-lg px-2 py-1 text-xs font-black tabular-nums ${
                          item.settlement === 'credit_card'
                            ? 'bg-info/10 text-info'
                            : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/45 dark:text-emerald-100'
                        }`}>
                          {item.settlement === 'credit_card' ? 'Kart ' : ''}{item.value}
                        </span>
                        {item.cashImpactAmount !== item.amount ? (
                          <span className="text-[10px] font-bold text-muted-foreground">Nakit {formatCurrency(item.cashImpactAmount)}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {groups.length > 4 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Takvimi daralt' : `Tüm günleri göster (${groups.length})`}
              </button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
