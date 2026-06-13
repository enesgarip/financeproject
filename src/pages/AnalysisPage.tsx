import { Archive, BarChart3, CalendarDays, CheckCircle2, Download, Flame, HandCoins, PieChart, Search, ShieldCheck, TrendingUp, Users, WalletCards } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { fetchPriceRadarRows, PRICE_RADAR_MONTHS, upsertAndLoadNetWorthSnapshots } from '../data/repositories/analysisRepo'
import { CrudPage, type FormField } from '../components/CrudPage'
import { BarChart, type BarDataPoint } from '../components/charts/BarChart'
import { CashFlowChart, type CashFlowPoint } from '../components/charts/CashFlowChart'
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import type { Budget, CardExpense, Debt, NetWorthSnapshot, Payment } from '../types/database'
import { SavingsGoalsPanel } from '../components/finance/SavingsGoalsPanel'
import { expenseCategoryOptions } from '../utils/categories'
import { dateInputValue, daysUntil, formatDate, isDateInMonth, monthlyOccurrenceDate, startOfMonth } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { buildCashFlowForecast } from '../utils/cashFlowForecast'
import { buildFinancialPosition, buildMonthlyCashFlow, getCurrentSalary, paymentOccurrenceInMonth, sum } from '../utils/financeSummary'
import {
  buildCalendarEvents,
  buildCategoryInsights,
  buildSearchCsv,
  buildSearchItems,
  formatMonth,
  type AnalysisData,
  type CalendarEvent,
  type SearchItem,
} from '../utils/analysisView'
import { activeExpense as activeCardExpense, buildBudgetUsage } from '../utils/budgetAlerts'
import { useMarketRates } from '../hooks/useMarketRates'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { convertNetWorth, formatRealValue, realValueChangeBadge, type RealUnit, REAL_UNIT_LABELS } from '../utils/realValue'
import { selectNetWorthSeries, type NetWorthRange } from '../utils/netWorthSeries'
import { applyScenario, type ScenarioMutation } from '../utils/scenarioForecast'
import { buildPriceObservations, detectPriceIncreases, type PriceTrend } from '../utils/priceIncreaseRadar'
import { computeFire, estimateMonthlySavingsFromNetWorth } from '../utils/fire'
import { buildInflationShield } from '../utils/inflationShield'
import { computeZakat } from '../utils/zakat'
import { canCutCurrentStatement } from '../utils/statementCycle'

const emptyAnalysisData: AnalysisData = {
  assets: [],
  cards: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  payments: [],
  salaryHistory: [],
  transactionHistory: [],
  cardExpenses: [],
  cardInstallments: [],
  cardStatementArchives: [],
  budgets: [],
  savingsGoals: [],
}

const optionalTableLabels: Record<string, string> = {
  card_installments: 'kart taksitleri',
  card_statement_archives: 'ekstre arşivi',
  budgets: 'bütçeler',
  savings_goals: 'birikim hedefleri',
}

const STATEMENT_ARCHIVE_LIMIT = 48

const budgetFields: FormField[] = [
  { name: 'month', label: 'Ay', type: 'date', required: true },
  { name: 'category', label: 'Kategori', type: 'select', options: expenseCategoryOptions },
  { name: 'limit_amount', label: 'Aylık limit', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function monthStartValue(value: FormDataEntryValue | null) {
  const date = value ? new Date(`${String(value)}T00:00:00`) : new Date()
  return dateInputValue(startOfMonth(Number.isNaN(date.getTime()) ? new Date() : date))
}

// Delegates to the shared occurrence rule so this page can never disagree with
// the cash-flow / obligations engines about which payments land this month.
function paymentInCurrentMonth(payment: Payment) {
  return paymentOccurrenceInMonth(payment) !== null
}

async function loadNetWorthSnapshots(
  userId: string,
  loadedData: AnalysisData,
  ratesSnapshot: MarketRatesSnapshot | null,
): Promise<NetWorthSnapshot[] | null> {
  const position = buildFinancialPosition({
    assets: loadedData.assets,
    cards: loadedData.cards,
    loans: loadedData.loans,
    loanInstallments: loadedData.loanInstallments,
    debts: loadedData.debts,
    payments: loadedData.payments,
    salaryHistory: loadedData.salaryHistory,
    cardInstallments: loadedData.cardInstallments,
  })
  const result = await upsertAndLoadNetWorthSnapshots(userId, {
    netWorth: position.netWorth,
    goldTry: ratesSnapshot?.rates?.GRA?.buying ?? null,
    usdTry: ratesSnapshot?.rates?.USD?.buying ?? null,
  })

  return result.ok ? result.data : null
}

function downloadCsv(items: SearchItem[]) {
  const blob = new Blob([buildSearchCsv(items)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `finans-rapor-${new Date().toLocaleDateString('sv-SE')}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function StatPill({ label, value, tone = 'stone' }: { label: string; value: string; tone?: 'emerald' | 'rose' | 'stone' }) {
  const toneClass = {
    emerald: 'text-success',
    rose: 'text-destructive',
    stone: 'text-foreground',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl bg-muted/55 px-3 py-2">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-[clamp(0.76rem,3.2vw,1rem)] font-extrabold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

function MonthlyReport({ data }: { data: AnalysisData }) {
  // Same engine the dashboard cash-flow card uses, so "Gelir / Çıkış / Net" here
  // can never disagree with the dashboard for the same month (credit-card auto
  // payments are excluded from cash outflow exactly like there).
  const cashFlow = buildMonthlyCashFlow(data)
  const cardSpending = sum(
    data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at)),
    (expense) => expense.amount,
  )
  const income = cashFlow.income
  const outflow = cashFlow.outflow
  const net = cashFlow.netFlow
  const reportRows = [
    { label: 'Kart ödemesi', value: cashFlow.cardOutflow },
    { label: 'Fatura/ödeme', value: cashFlow.paymentOutflow },
    { label: 'Kredi taksidi', value: cashFlow.loanOutflow },
    { label: 'Kişisel borç', value: cashFlow.debtOutflow },
  ]

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Aylık rapor</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{cashFlow.monthLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Download />
              PDF
            </Button>
            <div className="grid size-11 place-items-center rounded-xl bg-success/12 text-success">
              <BarChart3 />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Gelir" value={formatCurrency(income)} tone="emerald" />
          <StatPill label="Çıkış" value={formatCurrency(outflow)} tone="rose" />
          <StatPill label="Net" value={formatCurrency(net)} tone={net >= 0 ? 'emerald' : 'rose'} />
        </div>
        <div className="grid gap-2 min-[520px]:grid-cols-2">
          {reportRows.map((row) => (
            <div key={row.label} className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
              <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">{formatCurrency(row.value)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Kart harcaması toplamı: {formatCurrency(cardSpending)} · Bütçeler kategori bazlı harcama tutarını kullanır.
        </p>
      </CardContent>
    </Card>
  )
}

function UpcomingInstallments({ data }: { data: AnalysisData }) {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const loansById = new Map(data.loans.map((loan) => [loan.id, loan]))
  const monthKey = dateInputValue(startOfMonth())
  const cardItems = data.cardInstallments
    .filter((item) => item.status !== 'paid' && (item.status === 'scheduled' || item.due_month >= monthKey))
    .map((item) => {
      const isPastScheduled = item.status === 'scheduled' && item.due_month < monthKey
      const statusLabel = isPastScheduled ? 'Geçmiş dönem' : item.status === 'posted' ? 'Bu dönem' : 'Planlı'

      return {
        id: `card-${item.id}`,
        title: item.description,
        subtitle: `${cardsById.get(item.card_id)?.card_name ?? 'Kart'} · ${formatMonth(item.due_month)} · ${item.installment_no}/${item.installment_count}`,
        amount: item.amount,
        sortDate: item.due_month,
        statusLabel,
        tone: isPastScheduled ? 'destructive' : item.status === 'posted' ? 'default' : 'secondary',
      }
    })
  const loanItems = data.loanInstallments
    .filter((item) => item.status === 'bekliyor')
    .map((item) => {
      const loan = loansById.get(item.loan_id)
      const remaining = daysUntil(item.due_date)
      const statusLabel = remaining !== null && remaining < 0 ? 'Gecikmiş' : remaining === 0 ? 'Bugün' : 'Bekliyor'

      return {
        id: `loan-${item.id}`,
        title: loan ? loan.loan_name : 'Kredi taksidi',
        subtitle: `${loan?.bank_name ?? 'Kredi'} · ${formatDate(item.due_date)} · ${item.installment_no}. taksit`,
        amount: item.amount,
        sortDate: item.due_date,
        statusLabel,
        tone: remaining !== null && remaining < 0 ? 'destructive' : 'outline',
      }
    })
  const upcoming = [...cardItems, ...loanItems]
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate) || b.amount - a.amount)
    .slice(0, 8)

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Yaklaşan taksitler</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{upcoming.length} kart / kredi taksiti</p>
          </div>
          <WalletCards className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {upcoming.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bekleyen kart veya kredi taksiti yok.</p>
        ) : (
          upcoming.map((item) => (
            <div key={item.id} className="rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-semibold text-foreground">{item.title}</p>
                    <Badge variant={item.tone as 'default' | 'secondary' | 'destructive' | 'outline'}>{item.statusLabel}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.subtitle}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(item.amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function BudgetProgress({ budgets, expenses }: { budgets: Budget[]; expenses: CardExpense[] }) {
  // Same usage engine the dashboard budget-alert panel reads, so category spend
  // and over/warning thresholds match across the two screens.
  const usage = useMemo(() => buildBudgetUsage(budgets, expenses), [budgets, expenses])

  if (usage.length === 0) {
    return <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bu ay için bütçe eklediğinde kategori kullanımı burada görünecek.</p>
  }

  return (
    <div className="space-y-2">
      {usage.map((budget) => {
        const isOver = budget.status === 'over'
        const isWarning = budget.status === 'warning'

        return (
          <div
            key={budget.budgetId}
            className={`rounded-xl border p-3 ${isOver ? 'border-destructive/20 bg-destructive/8' : isWarning ? 'border-warning/20 bg-warning/8' : 'border-border/50 bg-muted/30'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{budget.category}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatCurrency(budget.spent)} / {formatCurrency(budget.limit)}
                </p>
                {isOver ? (
                  <p className="mt-0.5 text-xs font-medium text-destructive">
                    Limit {formatCurrency(budget.spent - budget.limit)} aşıldı
                  </p>
                ) : isWarning ? (
                  <p className="mt-0.5 text-xs font-medium text-warning">Limite yaklaşıyor</p>
                ) : null}
              </div>
              <Badge variant={isOver ? 'destructive' : isWarning ? 'secondary' : 'outline'}>%{Math.round(budget.usageRate)}</Badge>
            </div>
            <Progress value={Math.min(100, budget.usageRate)} className="mt-3 h-1.5" />
          </div>
        )
      })}
    </div>
  )
}

function StatementArchive({ data }: { data: AnalysisData }) {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const archives = data.cardStatementArchives.slice(0, 6)

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Ekstre arşivi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{archives.length} son kayıt</p>
          </div>
          <Archive className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {archives.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Ekstre kesildiğinde arşiv burada tutulacak.</p>
        ) : (
          archives.map((archive) => (
            <div key={archive.id} className="rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{cardsById.get(archive.card_id)?.card_name ?? 'Kart'}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(archive.statement_date)} · son ödeme {formatDate(archive.due_date)}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(archive.statement_debt_amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function SearchExport({ items }: { items: SearchItem[] }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const filteredItems = useMemo(
    () =>
      normalizedQuery
        ? items.filter((item) => `${item.type} ${item.title} ${item.subtitle}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
        : items.slice(0, 12),
    [items, normalizedQuery],
  )

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Genel arama ve dışa aktarım</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Varlık, kart, borç, ödeme, bütçe ve geçmiş kayıtları.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => downloadCsv(filteredItems)}>
            <Download />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ara: market, kart, kredi, hedef..."
            className="w-full rounded-xl border border-input bg-card/80 py-3 pl-10 pr-3 text-sm text-foreground outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50"
          />
        </label>
        <div className="space-y-2">
          {filteredItems.slice(0, 20).map((item, index) => (
            <div key={`${item.type}-${item.title}-${item.date}-${index}`} className="flex items-start justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.type} · {item.subtitle}
                </p>
              </div>
              {item.amount !== null ? (
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatCurrency(item.amount)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function FinancialCalendar({ data }: { data: AnalysisData }) {
  const { monthStart, daysInMonth, firstOffset, eventsByDate, busyDays } = useMemo(() => {
    const monthStart = startOfMonth()
    const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
    const firstOffset = (monthStart.getDay() + 6) % 7
    const eventsByDate = new Map<string, CalendarEvent[]>()

    for (const event of buildCalendarEvents(data)) {
      const dayEvents = eventsByDate.get(event.date)
      if (dayEvents) dayEvents.push(event)
      else eventsByDate.set(event.date, [event])
    }

    return {
      monthStart,
      daysInMonth,
      firstOffset,
      eventsByDate,
      busyDays: Array.from(eventsByDate.entries()).sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate)),
    }
  }, [data])

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Finans takvimi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{formatMonth(dateInputValue(monthStart))} içindeki nakit hareketleri.</p>
          </div>
          <CalendarDays className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
          {['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: firstOffset }, (_, index) => (
            <div key={`empty-${index}`} className="min-h-20 rounded-xl bg-transparent" />
          ))}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = index + 1
            const date = dateInputValue(new Date(monthStart.getFullYear(), monthStart.getMonth(), day))
            const dayEvents = eventsByDate.get(date) ?? []
            const dayTotal = dayEvents.reduce((total, event) => total + (event.tone === 'emerald' ? event.amount : -event.amount), 0)

            return (
              <div key={date} className="min-h-[6.25rem] rounded-lg bg-muted/45 p-1.5 ring-1 ring-transparent min-[560px]:min-h-[7rem]">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-foreground">{day}</span>
                  {dayEvents.length > 0 ? (
                    <span className={`hidden text-[10px] font-bold tabular-nums min-[560px]:inline ${dayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {dayTotal >= 0 ? '+' : ''}
                      {formatCurrency(dayTotal).replace(',00', '')}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-col gap-1">
                  {dayEvents.slice(0, 2).map((event) => (
                    <CalendarEventPill key={event.id} event={event} />
                  ))}
                  {dayEvents.length > 2 ? <p className="text-[10px] font-semibold leading-tight text-muted-foreground">+{dayEvents.length - 2} kayıt</p> : null}
                </div>
              </div>
            )
          })}
        </div>
        {busyDays.length > 0 ? (
          <div className="grid gap-2 min-[560px]:grid-cols-2">
            {busyDays.map(([date, dayEvents]) => {
              const dayTotal = dayEvents.reduce((total, event) => total + (event.tone === 'emerald' ? event.amount : -event.amount), 0)

              return (
                <div key={`detail-${date}`} className="rounded-lg bg-muted/45 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-foreground">{formatDate(date)}</span>
                    <span className={`shrink-0 font-bold tabular-nums ${dayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {dayTotal >= 0 ? '+' : ''}
                      {formatCurrency(dayTotal)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {dayEvents.map((event) => (
                      <div key={`detail-${event.id}`} className="flex min-w-0 items-start justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5">
                        <span className="min-w-0 break-words font-semibold text-foreground">{event.title}</span>
                        <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{formatCurrency(event.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CalendarEventPill({ event }: { event: CalendarEvent }) {
  const toneClass = {
    emerald: 'bg-success/12 text-success',
    rose: 'bg-destructive/12 text-destructive',
    amber: 'bg-warning/12 text-warning',
    stone: 'bg-muted text-muted-foreground',
  }[event.tone]

  return (
    <p
      title={`${event.title} - ${formatCurrency(event.amount)}`}
      className={`rounded-md px-1.5 py-1 text-[8.5px] font-semibold leading-[1.12] [overflow-wrap:anywhere] min-[560px]:text-[10px] ${toneClass}`}
    >
      {event.title}
    </p>
  )
}

const CATEGORY_PALETTE = [
  'var(--primary)', 'var(--success)', 'var(--warning)', 'var(--destructive)',
  'var(--info)', '#a78bfa', '#fb923c', '#38bdf8',
]

function PriceIncreaseRadar({ trends }: { trends: PriceTrend[] }) {
  if (trends.length === 0) return null
  const visible = trends.slice(0, 6)

  return (
    <Card className="border-border/70 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Zam radarı</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Düzenli gider ve aboneliklerinde zamanla artan kalemler (son {PRICE_RADAR_MONTHS - 1} ay).</p>
          </div>
          <TrendingUp size={18} className="text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-3 min-[640px]:grid-cols-2">
        {visible.map((trend) => (
          <div
            key={trend.key}
            className="rounded-xl bg-amber-50/70 px-3 py-2.5 ring-1 ring-amber-200/60 dark:bg-amber-950/20 dark:ring-amber-900/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-amber-900 dark:text-amber-100">{trend.label}</p>
                {trend.category ? (
                  <p className="truncate text-[11px] text-amber-700/80 dark:text-amber-300/70">{trend.category}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-md bg-amber-200/70 px-1.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                +%{Math.round(trend.changePct)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/70">
              {formatCurrency(trend.firstAmount)} → {formatCurrency(trend.lastAmount)} · {trend.monthsSpan} ayda
              {trend.monthsSpan >= 3 ? ` · yıllık ~%${Math.round(trend.annualizedPct)}` : ''}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function FireCalculator({ data, snapshots }: { data: AnalysisData; snapshots: NetWorthSnapshot[] }) {
  const position = useMemo(
    () =>
      buildFinancialPosition({
        assets: data.assets,
        cards: data.cards,
        loans: data.loans,
        loanInstallments: data.loanInstallments,
        debts: data.debts,
        payments: data.payments,
        salaryHistory: data.salaryHistory,
        cardInstallments: data.cardInstallments,
      }),
    [data.assets, data.cards, data.loans, data.loanInstallments, data.debts, data.payments, data.salaryHistory, data.cardInstallments],
  )

  // Living-cost proxy: average monthly card spending + steady monthly bills.
  const defaultExpenses = useMemo(() => {
    const active = data.cardExpenses.filter(activeCardExpense)
    const monthCount = Math.max(1, new Set(active.map((expense) => expense.spent_at.slice(0, 7))).size)
    const avgCard = sum(active, (expense) => expense.amount) / monthCount
    const monthlyRecurring = sum(data.payments.filter((payment) => payment.recurrence === 'monthly'), (payment) => payment.amount)
    return Math.round(avgCard + monthlyRecurring)
  }, [data.cardExpenses, data.payments])

  const salary = getCurrentSalary(data.salaryHistory)?.amount ?? 0
  const snapshotSavings = useMemo(() => estimateMonthlySavingsFromNetWorth(snapshots), [snapshots])
  const defaultSavings = snapshotSavings ?? Math.round(salary - defaultExpenses)
  const savingsSource = snapshotSavings !== null ? 'net değer trendi' : 'maaş − gider'

  const [realReturn, setRealReturn] = useState(4)
  const [withdrawal, setWithdrawal] = useState(4)
  // null override = follow the data-derived default (survives async data load).
  const [expensesOverride, setExpensesOverride] = useState<number | null>(null)
  const [savingsOverride, setSavingsOverride] = useState<number | null>(null)

  const monthlyExpenses = expensesOverride ?? defaultExpenses
  const monthlySavings = savingsOverride ?? defaultSavings

  const result = useMemo(
    () =>
      computeFire({
        currentNetWorth: position.netWorth,
        monthlyExpenses,
        monthlySavings,
        annualRealReturnPct: realReturn,
        withdrawalRatePct: withdrawal,
      }),
    [position.netWorth, monthlyExpenses, monthlySavings, realReturn, withdrawal],
  )

  const chartData: BarDataPoint[] = useMemo(() => {
    const points = result.projection
    const stride = Math.max(1, Math.ceil(points.length / 10))
    return points
      .filter((_, index) => index % stride === 0 || index === points.length - 1)
      .map((point) => ({
        label: point.month === 0 ? 'Bugün' : `${Math.round(point.month / 12)}y`,
        value: point.netWorth,
        color: result.fireNumber > 0 && point.netWorth >= result.fireNumber ? 'var(--success)' : 'var(--primary)',
      }))
  }, [result.projection, result.fireNumber])

  if (position.netWorth <= 0 && defaultExpenses <= 0) return null

  const headline = result.alreadyReached
    ? 'Finansal bağımsızlığa ulaştın 🎉'
    : result.monthsToFire === null
      ? 'Bu varsayımlarla hedefe ulaşılamıyor — birikimi artır.'
      : `Tahmini hedef: ${result.targetDate ? formatDate(result.targetDate) : '—'}`

  return (
    <Card className="border-border/70 lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Finansal bağımsızlık (FIRE)</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Bu birikim hızıyla pasif gelirin giderini ne zaman karşılar.</p>
          </div>
          <Flame size={18} className="text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-4">
          <StatPill label="Hedef servet" value={formatCurrency(result.fireNumber)} />
          <StatPill label="İlerleme" value={`%${Math.round(result.progressPct)}`} tone={result.progressPct >= 100 ? 'emerald' : 'stone'} />
          <StatPill
            label="Kalan süre"
            value={result.yearsToFire === null ? '—' : result.yearsToFire < 1 ? '<1 yıl' : `${result.yearsToFire.toFixed(1)} yıl`}
            tone={result.alreadyReached ? 'emerald' : result.monthsToFire === null ? 'rose' : 'stone'}
          />
          <StatPill label="Aylık birikim" value={formatCurrency(monthlySavings)} tone={monthlySavings >= 0 ? 'emerald' : 'rose'} />
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{headline}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {formatCurrency(position.netWorth)} / {formatCurrency(result.fireNumber)}
            </span>
          </div>
          <Progress value={result.progressPct} autoColor size="default" />
        </div>

        <div className="grid gap-3 min-[720px]:grid-cols-2">
          <label className="rounded-xl bg-muted/40 p-3">
            <span className="finance-label">Aylık gider</span>
            <input
              type="number"
              min="0"
              step="500"
              value={monthlyExpenses}
              onChange={(event) => setExpensesOverride(parseNumber(event.target.value))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <span className="finance-label">
              Aylık birikim <span className="font-normal normal-case text-muted-foreground">({savingsSource})</span>
            </span>
            <input
              type="number"
              step="500"
              value={monthlySavings}
              onChange={(event) => setSavingsOverride(parseNumber(event.target.value))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="finance-label">Yıllık reel getiri</span>
              <span className="text-sm font-bold tabular-nums text-foreground">%{realReturn}</span>
            </div>
            <input
              type="range"
              min="0"
              max="15"
              step="0.5"
              value={realReturn}
              onChange={(event) => setRealReturn(Number(event.target.value))}
              aria-label="Yıllık reel getiri yüzdesi"
              className="mt-2 w-full accent-primary"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="finance-label">Güvenli çekim oranı</span>
              <span className="text-sm font-bold tabular-nums text-foreground">%{withdrawal} · {(100 / withdrawal).toFixed(0)}×</span>
            </div>
            <input
              type="range"
              min="2.5"
              max="6"
              step="0.5"
              value={withdrawal}
              onChange={(event) => setWithdrawal(Number(event.target.value))}
              aria-label="Güvenli çekim oranı yüzdesi"
              className="mt-2 w-full accent-primary"
            />
          </label>
        </div>

        <div className="rounded-xl bg-muted/20 p-2">
          <BarChart data={chartData} height={200} />
        </div>
      </CardContent>
    </Card>
  )
}

const SHIELD_COLORS: Record<string, string> = {
  Nakit: 'var(--warning)',
  Altın: '#f59e0b',
  Hisse: 'var(--primary)',
  Fon: 'var(--info)',
  BES: '#a78bfa',
  Araç: '#94a3b8',
  Diğer: '#64748b',
}

function InflationShieldPanel({ data }: { data: AnalysisData }) {
  const shield = useMemo(() => buildInflationShield(data.assets, data.cards), [data.assets, data.cards])
  if (shield.totalValue <= 0) return null

  const protectedPct = Math.round(shield.protectedRatio * 100)
  const meltingPct = 100 - protectedPct
  const donutData: DonutSlice[] = shield.categories.map((category) => ({
    name: category.category,
    value: category.value,
    color: SHIELD_COLORS[category.category] ?? (category.bucket === 'melting' ? 'var(--warning)' : 'var(--primary)'),
  }))
  const headline =
    protectedPct >= 60
      ? 'Servetinin büyük kısmı enflasyona karşı reel varlıkta.'
      : protectedPct >= 35
        ? 'Reel varlık payın orta seviyede; TL nakit oranını izlemekte fayda var.'
        : 'Servetinin çoğu eriyen TL nakitte — enflasyon riski yüksek.'

  return (
    <Card className="border-border/70 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Enflasyon kalkanı</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Servetinin ne kadarı reel varlıkta, ne kadarı eriyen TL nakitte.</p>
          </div>
          <ShieldCheck size={18} className="text-emerald-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-2">
          <StatPill label="Reel / korumalı" value={`%${protectedPct}`} tone={protectedPct >= 60 ? 'emerald' : 'stone'} />
          <StatPill label="Eriyen TL nakit" value={`%${meltingPct}`} tone={meltingPct > 65 ? 'rose' : 'stone'} />
        </div>
        <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">{headline}</div>
        <DonutChart data={donutData} size={180} innerRadius={50} totalLabel="Varlık" />
      </CardContent>
    </Card>
  )
}

function ZakatToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-xs ring-1 ring-border/60">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-3.5 accent-primary" />
      <span className="text-muted-foreground">{label}</span>
    </label>
  )
}

function ZakatPanel({ data, ratesSnapshot }: { data: AnalysisData; ratesSnapshot: MarketRatesSnapshot | null }) {
  const [includeReceivables, setIncludeReceivables] = useState(true)
  const [includeBes, setIncludeBes] = useState(false)
  const [deductDebts, setDeductDebts] = useState(true)

  const gramGoldPrice = ratesSnapshot?.rates?.GRA?.buying ?? null
  const zakat = useMemo(
    () =>
      computeZakat(
        {
          assets: data.assets,
          cards: data.cards,
          loans: data.loans,
          loanInstallments: data.loanInstallments,
          debts: data.debts,
          payments: data.payments,
          salaryHistory: data.salaryHistory,
          cardInstallments: data.cardInstallments,
        },
        gramGoldPrice,
        { includeReceivables, includeBes, deductDebts },
      ),
    [data, gramGoldPrice, includeReceivables, includeBes, deductDebts],
  )

  if (zakat.zakatableAssets <= 0) return null

  return (
    <Card className="border-border/70 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Zekât hesaplayıcı</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Diyanet ölçüsü: 80,18 gr altın nisabı, %2,5 oran, borçlar düşülür.</p>
          </div>
          <HandCoins size={18} className="text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-3">
          <StatPill label="Zekâta tabi net servet" value={formatCurrency(zakat.netWealth)} />
          <StatPill label="Nisab (80,18 gr altın)" value={zakat.nisabTry === null ? '—' : formatCurrency(zakat.nisabTry)} />
          <StatPill
            label="Hesaplanan zekât"
            value={formatCurrency(zakat.zakatDue)}
            tone={zakat.meetsNisab ? 'emerald' : 'stone'}
          />
        </div>

        <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          {zakat.nisabTry === null
            ? 'Gram altın fiyatı yüklenemediği için nisab hesaplanamadı.'
            : zakat.meetsNisab
              ? 'Net servetin nisabı aştı; %2,5 zekât hesaplandı.'
              : 'Net servetin nisabın altında — zekât gerekmiyor.'}
        </div>

        <div className="rounded-xl bg-muted/40 p-3">
          <p className="finance-label mb-2">Hesap kalemleri</p>
          <div className="grid gap-1.5">
            {zakat.components.map((component) => (
              <div key={component.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{component.sign < 0 ? '− ' : '+ '}{component.label}</span>
                <span className={`font-mono tabular-nums ${component.sign < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {component.sign < 0 ? '-' : ''}{formatCurrency(component.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <ZakatToggle checked={includeReceivables} onChange={setIncludeReceivables} label="Alacakları dahil et" />
          <ZakatToggle checked={deductDebts} onChange={setDeductDebts} label="Borçları düş" />
          <ZakatToggle checked={includeBes} onChange={setIncludeBes} label="BES'i dahil et" />
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Bu bir tahmindir; uygulama bir mal üzerinden bir yıl (hawl) geçip geçmediğini takip edemez ve hisse/fon için
          basitleştirilmiş piyasa değeri kullanır. Kesin hüküm için bir yetkiliye danışın.
        </p>
      </CardContent>
    </Card>
  )
}

function CategorySpendingChart({ data }: { data: AnalysisData }) {
  const monthlyExpenses = useMemo(
    () => data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at)),
    [data.cardExpenses],
  )
  const insights = useMemo(() => buildCategoryInsights(data), [data])
  const categoryTotals = Array.from(
    monthlyExpenses.reduce((map, expense) => {
      const category = expense.category || 'Diğer'
      map.set(category, (map.get(category) ?? 0) + expense.amount)
      return map
    }, new Map<string, number>()),
    ([category, amount]) => ({ category, amount }),
  ).sort((a, b) => b.amount - a.amount)

  const donutData: DonutSlice[] = categoryTotals.slice(0, 7).map((item, i) => ({
    name:  item.category,
    value: item.amount,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
  }))

  return (
    <Card className="border-border/70 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kategori harcaması</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Bu ay kart harcamalarının dağılımı.</p>
          </div>
          <PieChart size={18} className="text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {donutData.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bu ay kategorili kart harcaması yok.</p>
        ) : (
          <DonutChart data={donutData} size={180} innerRadius={50} totalLabel="Bu ay" />
        )}
        {insights.length > 0 ? (
          <div className="rounded-xl bg-muted/40 p-3">
            <p className="finance-label mb-2">Kategori içgörüleri</p>
            <div className="grid gap-2">
              {insights.map((insight) => (
                <div key={`${insight.category}-${insight.title}`} className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border/60">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{insight.category}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{insight.title} · {insight.description}</p>
                  </div>
                  <Badge variant={insight.tone === 'rose' ? 'destructive' : insight.tone === 'amber' ? 'warning' : 'success'}>
                    {formatCurrency(insight.amount)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CashFlowTrend({ data }: { data: AnalysisData }) {
  const chartData: CashFlowPoint[] = useMemo(() => {
    const salary = getCurrentSalary(data.salaryHistory)?.amount ?? 0
    const months = Array.from({ length: 6 }, (_, index) => new Date(new Date().getFullYear(), new Date().getMonth() - 5 + index, 1))

    return months.map((month) => {
      const income = salary + sum(
        data.debts.filter((debt) => debt.direction === 'borç_verdim' && debt.status === 'açık' && isDateInMonth(debt.due_date, month)),
        (debt) => debt.estimated_value_try,
      )
      const outflow =
        sum(data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at, month)), (expense) => expense.amount) +
        sum(data.payments.filter((payment) => {
          if (payment.status !== 'bekliyor') return false
          if (payment.recurrence === 'monthly') return Boolean(monthlyOccurrenceDate(payment.recurrence_day, month))
          return isDateInMonth(payment.due_date, month)
        }), (payment) => payment.amount) +
        sum(data.loanInstallments.filter((installment) => isDateInMonth(installment.due_date, month)), (installment) => installment.amount) +
        sum(data.debts.filter((debt) => debt.direction === 'borç_aldım' && debt.status === 'açık' && isDateInMonth(debt.due_date, month)), (debt) => debt.estimated_value_try)

      return {
        label: new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(month),
        income,
        outflow,
        net: income - outflow,
      }
    })
  }, [data.cardExpenses, data.debts, data.loanInstallments, data.payments, data.salaryHistory])

  const totalNet = useMemo(() => chartData.reduce((s, r) => s + r.net, 0), [chartData])

  return (
    <Card className="border-border/70 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>6 aylık nakit akışı</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Gelir ve planlı çıkışların aylık karşılaştırması.</p>
          </div>
          <Badge variant={totalNet >= 0 ? 'success' : 'destructive'}>
            {totalNet >= 0 ? 'Pozitif' : 'Negatif'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <div className="rounded-xl bg-muted/20 p-2">
          <CashFlowChart data={chartData} height={220} />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" />
            Gelir
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            Gider
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Net
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function shortMonth(monthKey: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(new Date(`${monthKey}T00:00:00`))
}

function NetWorthTrend({
  snapshots,
  ratesSnapshot,
}: {
  snapshots: NetWorthSnapshot[]
  ratesSnapshot: MarketRatesSnapshot | null
}) {
  const [unit, setUnit] = useState<RealUnit>('TRY')
  const [range, setRange] = useState<NetWorthRange>('90d')
  const { series: derived, aggregated } = useMemo(
    () => selectNetWorthSeries(snapshots, range, new Date()),
    [snapshots, range],
  )
  // Seçilen aralıkta <2 nokta varsa (ör. yeni veri) tüm seriye düş.
  const view = derived.length >= 2 ? derived : snapshots

  if (snapshots.length < 2) {
    return (
      <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
        <CardHeader className="pb-0">
          <CardTitle>Net değer trendi</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Geçmişe dönük net değer değişimi.</p>
        </CardHeader>
        <CardContent className="pt-3">
          <p className="rounded-xl bg-muted/45 p-4 text-sm text-muted-foreground">
            Trend grafiği her gün AnalysisPage açıldığında güncellenir; birkaç gün sonra burada görünür.
          </p>
        </CardContent>
      </Card>
    )
  }

  const latest = snapshots.at(-1)! // Güncel = gerçek son değer (aralıktan bağımsız)
  const first = view[0]!
  const spansDifferentYears = new Date(first.snapshot_date).getFullYear() !== new Date(latest.snapshot_date).getFullYear()

  // Current rates for stat pills (always use live rates for "güncel" display)
  const currentRates = {
    goldTry: ratesSnapshot?.rates?.GRA?.buying ?? null,
    usdTry: ratesSnapshot?.rates?.USD?.buying ?? null,
  }

  // Per-snapshot rates: use stored rate when available, fall back to current
  function snapshotRates(s: NetWorthSnapshot) {
    return {
      goldTry: s.gold_try ?? currentRates.goldTry,
      usdTry: s.usd_try ?? currentRates.usdTry,
    }
  }

  function convertSnapshot(s: NetWorthSnapshot): number | null {
    return convertNetWorth(s.net_worth, unit, snapshotRates(s))
  }

  function displayValue(tryAmount: number, rates: { goldTry?: number | null; usdTry?: number | null }): string {
    if (unit === 'TRY') return formatCurrency(tryAmount)
    const converted = convertNetWorth(tryAmount, unit, rates)
    if (converted === null) return '—'
    return formatRealValue(converted, unit)
  }

  function snapshotLabel(s: NetWorthSnapshot) {
    const d = new Date(`${s.snapshot_date}T00:00:00`)
    const month = new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(d)
    return spansDifferentYears ? `${month} '${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${month}`
  }

  const barData: BarDataPoint[] = view.map((s) => ({
    label: snapshotLabel(s),
    value: convertSnapshot(s) ?? 0,
  }))

  const latestConverted = convertNetWorth(latest.net_worth, unit, currentRates)
  const firstConverted = convertNetWorth(first.net_worth, unit, snapshotRates(first))
  const minSnap = view.reduce((a, b) => (b.net_worth < a.net_worth ? b : a))
  const maxSnap = view.reduce((a, b) => (b.net_worth > a.net_worth ? b : a))

  const changeTry = latest.net_worth - first.net_worth
  const changeBadge =
    unit === 'TRY'
      ? `${changeTry >= 0 ? '+' : ''}${formatCurrency(changeTry)}`
      : (realValueChangeBadge(changeTry, unit, currentRates) ??
        (latestConverted !== null && firstConverted !== null
          ? `${latestConverted - firstConverted >= 0 ? '+' : ''}${formatRealValue(latestConverted - firstConverted, unit)}`
          : null))

  const hasRates = currentRates.goldTry !== null && currentRates.usdTry !== null

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Net değer trendi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {aggregated
                ? `${view.length} ay · aylık (ay sonu) görünüm.`
                : `Son ${view.length} gün · günlük otomatik anlık görüntü.`}
            </p>
          </div>
          {changeBadge ? (
            <Badge variant={changeTry >= 0 ? 'success' : 'destructive'}>{changeBadge}</Badge>
          ) : null}
        </div>
        {/* Range toggle (roadmap Y7) */}
        <div className="mt-2 flex gap-1">
          {([
            ['90d', '90 gün'],
            ['1y', '1 yıl'],
            ['all', 'Tümü'],
          ] as [NetWorthRange, string][]).map(([r, label]) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                range === r ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
              ].join(' ')}
              aria-label={`Net değer trendini ${label} aralığında göster`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Unit toggle */}
        <div className="mt-2 flex gap-1">
          {(['TRY', 'GRA', 'USD'] as RealUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              disabled={u !== 'TRY' && !hasRates}
              className={[
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                unit === u
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                u !== 'TRY' && !hasRates ? 'cursor-not-allowed opacity-40' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={u !== 'TRY' && !hasRates ? 'Kur verisi yükleniyor...' : undefined}
              aria-label={`Net değeri ${REAL_UNIT_LABELS[u]} cinsinden göster`}
            >
              {REAL_UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <StatPill
            label="Güncel"
            value={displayValue(latest.net_worth, currentRates)}
            tone={latest.net_worth >= 0 ? 'emerald' : 'rose'}
          />
          <StatPill
            label="En yüksek"
            value={displayValue(maxSnap.net_worth, snapshotRates(maxSnap))}
            tone="emerald"
          />
          <StatPill
            label="En düşük"
            value={displayValue(minSnap.net_worth, snapshotRates(minSnap))}
            tone={minSnap.net_worth < 0 ? 'rose' : 'stone'}
          />
        </div>
        <div className="rounded-xl bg-muted/20 p-2">
          <BarChart data={barData} height={200} positiveColor="var(--success)" />
        </div>
      </CardContent>
    </Card>
  )
}

function ForwardForecast({ data }: { data: AnalysisData }) {
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  const forecastInput = useMemo(
    () => ({
      assets: data.assets,
      cards: data.cards,
      loans: data.loans,
      loanInstallments: data.loanInstallments,
      debts: data.debts,
      payments: data.payments,
      salaryHistory: data.salaryHistory,
      cardInstallments: data.cardInstallments,
    }),
    [data],
  )

  const forecast = useMemo(() => buildCashFlowForecast(forecastInput, { horizonMonths: 6 }), [forecastInput])

  const scenarioMutations = useMemo<ScenarioMutation[]>(() => {
    if (removedIds.size === 0) return []
    const mutations: ScenarioMutation[] = []
    for (const id of removedIds) {
      if (data.loans.some((l) => l.id === id)) mutations.push({ type: 'remove_loan', loanId: id })
      else mutations.push({ type: 'remove_payment', paymentId: id })
    }
    return mutations
  }, [removedIds, data.loans])

  const scenarioForecast = useMemo(() => {
    if (scenarioMutations.length === 0) return null
    return buildCashFlowForecast(applyScenario(forecastInput, scenarioMutations), { horizonMonths: 6 })
  }, [forecastInput, scenarioMutations])

  const activeForBarChart = scenarioForecast ?? forecast
  const barData: BarDataPoint[] = useMemo(
    () =>
      activeForBarChart.months.map((month) => ({
        label: shortMonth(month.monthKey),
        value: month.endingBalance,
      })),
    [activeForBarChart],
  )
  const hasDeficit = activeForBarChart.firstNegative !== null

  const candidateLoans = data.loans.filter((l) => l.status === 'active' && l.remaining_installments > 0)
  const candidatePayments = data.payments.filter((p) => p.recurrence !== 'none' && p.status !== 'ödendi')

  function toggleId(id: string) {
    setRemovedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const endingDelta = scenarioForecast ? scenarioForecast.endingBalance - forecast.endingBalance : null

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>İleriye dönük nakit</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Önümüzdeki 6 ay · bilinen gelir ve yükümlülüklere göre tahmini bakiye.</p>
          </div>
          <Badge variant={hasDeficit ? 'destructive' : 'success'}>{hasDeficit ? 'Açık riski' : 'Pozitif'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Başlangıç" value={formatCurrency(activeForBarChart.startingBalance)} />
          <StatPill
            label={activeForBarChart.lowest ? `En düşük · ${shortMonth(activeForBarChart.lowest.monthKey)}` : 'En düşük'}
            value={formatCurrency(activeForBarChart.lowest?.balance ?? activeForBarChart.startingBalance)}
            tone={(activeForBarChart.lowest?.balance ?? 0) < 0 ? 'rose' : 'stone'}
          />
          <StatPill
            label="6 ay sonu"
            value={formatCurrency(activeForBarChart.endingBalance)}
            tone={activeForBarChart.endingBalance >= activeForBarChart.startingBalance ? 'emerald' : 'rose'}
          />
        </div>

        {activeForBarChart.firstNegative ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3">
            <p className="text-sm font-bold text-destructive">{activeForBarChart.firstNegative.monthLabel} içinde nakit açığa düşüyor</p>
            <p className="mt-0.5 text-xs text-destructive/80">
              Tahmini bakiye {formatCurrency(activeForBarChart.firstNegative.balance)}. Büyük ödemeleri veya tahsilatı öne almak iyi olur.
            </p>
          </div>
        ) : null}

        {scenarioForecast && !scenarioForecast.firstNegative && forecast.firstNegative ? (
          <div className="rounded-xl border border-success/20 bg-success/8 p-3">
            <p className="text-sm font-bold text-success">Simülasyonda nakit açığı ortadan kalkıyor</p>
            <p className="mt-0.5 text-xs text-success/80">Seçili yükümlülükleri kaldırmak 6 ay boyunca pozitif bakiyeyi koruyor.</p>
          </div>
        ) : null}

        <div className="rounded-xl bg-muted/20 p-2">
          <BarChart data={barData} height={200} positiveColor="var(--success)" />
        </div>

        <div className="grid gap-2 min-[560px]:grid-cols-2">
          {activeForBarChart.months.map((month) => (
            <div key={month.monthKey} className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{month.monthLabel}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Net{' '}
                  <span className={month.net >= 0 ? 'text-success' : 'text-destructive'}>
                    {month.net >= 0 ? '+' : ''}
                    {formatCurrency(month.net)}
                  </span>
                </p>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 font-mono text-xs font-bold tabular-nums ring-1 ring-border/60 ${month.endingBalance < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'}`}
              >
                {formatCurrency(month.endingBalance)}
              </span>
            </div>
          ))}
        </div>

        {/* Scenario simulator */}
        {(candidateLoans.length > 0 || candidatePayments.length > 0) ? (
          <div className="rounded-xl border border-border/50 bg-muted/20">
            <button
              aria-expanded={scenarioOpen}
              onClick={() => setScenarioOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground"
            >
              <span>Ya şöyle olsaydı?</span>
              <span className="flex items-center gap-2">
                {removedIds.size > 0 && endingDelta !== null ? (
                  <Badge variant={endingDelta >= 0 ? 'success' : 'destructive'}>
                    {endingDelta >= 0 ? '+' : ''}{formatCurrency(endingDelta)}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">{scenarioOpen ? '▲' : '▼'}</span>
              </span>
            </button>

            {scenarioOpen ? (
              <div className="space-y-3 border-t border-border/40 px-4 pb-4 pt-3">
                {candidateLoans.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Krediler</p>
                    <div className="space-y-1.5">
                      {candidateLoans.map((loan) => (
                        <label key={loan.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                          <input
                            type="checkbox"
                            checked={removedIds.has(loan.id)}
                            onChange={() => toggleId(loan.id)}
                            className="h-4 w-4 accent-primary"
                            aria-label={`${loan.loan_name} kredisini kaldır`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{loan.loan_name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(loan.monthly_payment)}/ay</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {candidatePayments.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Düzenli ödemeler</p>
                    <div className="space-y-1.5">
                      {candidatePayments.map((payment) => (
                        <label key={payment.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                          <input
                            type="checkbox"
                            checked={removedIds.has(payment.id)}
                            onChange={() => toggleId(payment.id)}
                            className="h-4 w-4 accent-primary"
                            aria-label={`${payment.title} ödemesini kaldır`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{payment.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(payment.amount)}/ay</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {removedIds.size > 0 ? (
                  <button
                    onClick={() => setRemovedIds(new Set())}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Sıfırla
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PeopleLedger({ debts }: { debts: Debt[] }) {
  const rows = Array.from(
    debts
      .filter((debt) => debt.status === 'açık')
      .reduce((map, debt) => {
        const current = map.get(debt.person_name) ?? { person: debt.person_name, borrowed: 0, receivable: 0, count: 0 }
        if (debt.direction === 'borç_aldım') current.borrowed += debt.estimated_value_try
        else current.receivable += debt.estimated_value_try
        current.count += 1
        map.set(debt.person_name, current)
        return map
      }, new Map<string, { person: string; borrowed: number; receivable: number; count: number }>()),
    ([, value]) => value,
  ).sort((a, b) => Math.abs(b.receivable - b.borrowed) - Math.abs(a.receivable - a.borrowed))

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kişi bazlı bakiye</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Açık borç ve alacakları kişi profili gibi oku.</p>
          </div>
          <Users className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {rows.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Açık kişi borcu veya alacağı yok.</p>
        ) : (
          rows.slice(0, 6).map((row) => {
            const net = row.receivable - row.borrowed
            return (
              <div key={row.person} className="rounded-xl bg-muted/45 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{row.person}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.count} açık kayıt</p>
                  </div>
                  <Badge variant={net >= 0 ? 'default' : 'destructive'}>{net >= 0 ? 'Alacak' : 'Borç'}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <StatPill label="Alacak" value={formatCurrency(row.receivable)} tone="emerald" />
                  <StatPill label="Borç" value={formatCurrency(row.borrowed)} tone="rose" />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

function MonthCloseAssistant({ data, missingTables }: { data: AnalysisData; missingTables: string[] }) {
  const monthKey = dateInputValue(startOfMonth())
  const today = new Date()
  const currentMonthExpenses = data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at))
  const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  const statementDayPassedCards = creditCards.filter((card) => canCutCurrentStatement(card, data.cardStatementArchives, today))
  const staleInstallments = data.cardInstallments.filter((item) => item.status === 'scheduled' && item.due_month <= monthKey).length
  const openPaymentCount = data.payments.filter((payment) => paymentInCurrentMonth(payment) || (payment.status === 'bekliyor' && (daysUntil(payment.due_date) ?? 0) < 0)).length
  const budgetOverruns = data.budgets.filter((budget) => {
    if (budget.month !== monthKey || budget.limit_amount <= 0) return false
    const spent = sum(
      currentMonthExpenses.filter((expense) => (expense.category || 'Diğer') === budget.category),
      (expense) => expense.amount,
    )
    return spent > budget.limit_amount
  }).length
  const checks = [
    { label: 'Ekstreler kontrol edildi', done: statementDayPassedCards.length === 0, detail: statementDayPassedCards.length > 0 ? `${statementDayPassedCards.length} kart bekliyor` : 'Kesim günü geçmiş açık dönem yok' },
    { label: 'Taksitler işlendi', done: staleInstallments === 0, detail: staleInstallments > 0 ? `${staleInstallments} taksit planlı kaldı` : 'Bu aya kadar planlı taksit yok' },
    { label: 'Maaş kaydı güncel', done: Boolean(getCurrentSalary(data.salaryHistory)), detail: getCurrentSalary(data.salaryHistory) ? formatCurrency(getCurrentSalary(data.salaryHistory)?.amount ?? 0) : 'Maaş eklenmedi' },
    { label: 'Faturalar kapandı', done: openPaymentCount === 0, detail: openPaymentCount > 0 ? `${openPaymentCount} açık ödeme` : 'Açık vade görünmüyor' },
    { label: 'Bütçe aşımı yok', done: budgetOverruns === 0, detail: budgetOverruns > 0 ? `${budgetOverruns} kategori limit üstü` : 'Limitler sakin' },
    { label: 'Veri altyapısı hazır', done: missingTables.length === 0, detail: missingTables.length > 0 ? `${missingTables.length} migration bekliyor` : 'Tablolar erişilebilir' },
  ]
  const completed = checks.filter((check) => check.done).length

  return (
    <Card className="border-0 bg-card/95 text-foreground shadow-[var(--shadow-card)] ring-1 ring-border/80 lg:col-span-12">
      <CardContent className="grid gap-4 p-4 min-[760px]:grid-cols-[0.72fr_1.28fr] min-[760px]:items-center">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-success" />
            <h2 className="text-base font-extrabold">Ay kapanış asistanı</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatMonth(monthKey)} için {completed}/{checks.length} kontrol tamam. Raporu PDF olarak yazdırıp arşivleyebilirsin.
          </p>
        </div>
        <div className="grid gap-2 min-[560px]:grid-cols-2 min-[980px]:grid-cols-3">
          {checks.map((check) => (
            <div key={check.label} className={`rounded-lg px-3 py-2 ${check.done ? 'bg-success/10 text-success' : 'bg-muted/55 text-muted-foreground'}`}>
              <p className="truncate text-xs font-bold">{check.label}</p>
              <p className="mt-0.5 truncate text-[11px] opacity-70">{check.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SchemaMigrationNotice({ missingTables }: { missingTables: string[] }) {
  if (missingTables.length === 0) return null

  const labels = missingTables.map((table) => optionalTableLabels[table] ?? table).join(', ')

  return (
    <Card className="border-warning/25 bg-warning/8 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardContent className="p-4">
        <p className="text-sm font-bold text-warning">Canlı veritabanı migration bekliyor</p>
        <p className="mt-1 text-sm text-warning/80">
          {labels} tabloları henüz canlı Supabase tarafında görünmüyor. Ekranı kırmadan mevcut verilerle devam ediyorum.
        </p>
      </CardContent>
    </Card>
  )
}

export function AnalysisPage() {
  const { user } = useAuth()
  const { snapshot: ratesSnapshot } = useMarketRates()
  const ratesSnapshotRef = useRef<MarketRatesSnapshot | null>(null)
  useEffect(() => { ratesSnapshotRef.current = ratesSnapshot }, [ratesSnapshot])

  const snapshotQuery = useFinanceSnapshot()
  const userId = user?.id

  // Dashboard'la paylaşılan 6 aylık snapshot'tan analiz görünümünü türet:
  // taksitlerde ödenmişler hariç, ekstre arşivi 48 kayıtla sınırlı.
  const data: AnalysisData = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot) return emptyAnalysisData
    return {
      assets: snapshot.assets,
      cards: snapshot.cards,
      loans: snapshot.loans,
      loanInstallments: snapshot.loanInstallments,
      debts: snapshot.debts,
      payments: snapshot.payments,
      salaryHistory: snapshot.salaryHistory,
      transactionHistory: snapshot.transactionHistory,
      cardExpenses: snapshot.cardExpenses,
      cardInstallments: snapshot.cardInstallments.filter((installment) => installment.status !== 'paid'),
      cardStatementArchives: snapshot.cardStatements.slice(0, STATEMENT_ARCHIVE_LIMIT),
      budgets: snapshot.budgets,
      savingsGoals: snapshot.savingsGoals,
    }
  }, [snapshotQuery.data])

  const loading = snapshotQuery.isPending
  const error = snapshotQuery.error instanceof Error ? snapshotQuery.error.message : ''
  const missingTables = useMemo(
    () => (snapshotQuery.data?.missingTables ?? []).filter((table) => table in optionalTableLabels),
    [snapshotQuery.data],
  )

  // Net değer serisi: bugünü upsert edip son 90 günü okur. Snapshot her
  // tazelendiğinde (dataUpdatedAt) yeniden hesaplanır; hata analiz render'ını engellemez.
  const netWorthQuery = useQuery({
    queryKey: ['net-worth-snapshots', userId, snapshotQuery.dataUpdatedAt],
    enabled: Boolean(userId && snapshotQuery.data),
    staleTime: Infinity,
    queryFn: async () => {
      try {
        return (await loadNetWorthSnapshots(userId as string, data, ratesSnapshotRef.current)) ?? []
      } catch {
        return [] as NetWorthSnapshot[]
      }
    },
  })
  const snapshots = netWorthQuery.data ?? []

  // Zam radarı: 13 aylık bağımsız pencere, best-effort.
  const priceTrendsQuery = useQuery({
    queryKey: ['price-trends', userId, snapshotQuery.dataUpdatedAt],
    enabled: Boolean(userId && snapshotQuery.data),
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const radarResult = await fetchPriceRadarRows()
        if (!radarResult.ok) return [] as PriceTrend[]

        const radar = radarResult.data
        const observations = buildPriceObservations({
          transactionHistory: radar.transactionHistory,
          payments: data.payments,
          cardExpenses: radar.cardExpenses,
        })
        return detectPriceIncreases(observations)
      } catch {
        return [] as PriceTrend[]
      }
    },
  })
  const priceTrends = priceTrendsQuery.data ?? []

  const searchItems = useMemo(() => buildSearchItems(data), [data])
  const canManageBudgets = !missingTables.includes('budgets')
  const canManageGoals = !missingTables.includes('savings_goals')

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <SchemaMigrationNotice missingTables={missingTables} />
        <MonthCloseAssistant data={data} missingTables={missingTables} />
        <MonthlyReport data={data} />
        <UpcomingInstallments data={data} />
        <FinancialCalendar data={data} />
        <CategorySpendingChart data={data} />
        <PriceIncreaseRadar trends={priceTrends} />
        <CashFlowTrend data={data} />
        <NetWorthTrend snapshots={snapshots} ratesSnapshot={ratesSnapshot} />
        <InflationShieldPanel data={data} />
        <ZakatPanel data={data} ratesSnapshot={ratesSnapshot} />
        <ForwardForecast data={data} />
        <FireCalculator data={data} snapshots={snapshots} />
        <PeopleLedger debts={data.debts} />
        <SearchExport items={searchItems} />
        <StatementArchive data={data} />
      </div>

      {loading ? <p className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">Analiz verileri yükleniyor...</p> : null}

      {canManageBudgets ? (
      <CrudPage
        table="budgets"
        pageTitle="Bütçeler"
        addLabel="Bütçe ekle"
        fields={budgetFields}
        emptyTitle="Henüz bütçe yok"
        emptyDescription="Kategori bazlı aylık limit ekleyerek harcama takibini başlatabilirsin."
        orderBy="month"
        orderAscending={false}
        renderBeforeList={({ loading, rows }) =>
          !loading ? <BudgetProgress budgets={rows as Budget[]} expenses={data.cardExpenses} /> : null
        }
        getInitialValues={(row?: Budget) => ({
          month: row?.month ?? dateInputValue(startOfMonth()),
          category: row?.category ?? expenseCategoryOptions[0]?.value ?? 'Diğer',
          limit_amount: row?.limit_amount ?? 0,
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => ({
          user_id: userId,
          month: monthStartValue(formData.get('month')),
          category: String(formData.get('category') ?? 'Diğer'),
          limit_amount: parseNumber(formData.get('limit_amount')),
          note: String(formData.get('note') ?? '') || null,
        })}
        renderTitle={(row) => row.category}
        renderSubtitle={(row) => formatMonth(row.month)}
        renderDetails={(row) => [`Limit: ${formatCurrency(row.limit_amount)}`]}
      />
      ) : null}

      {canManageGoals ? <SavingsGoalsPanel /> : null}
    </section>
  )
}
