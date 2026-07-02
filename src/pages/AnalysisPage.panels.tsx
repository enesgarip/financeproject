import { Award, CalendarDays, CheckCircle2, Moon, Repeat, TrendingUp, Users, WalletCards } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import type { Budget, CardExpense, Debt, NetWorthSnapshot } from '../types/database'
import { dateInputValue, daysUntil, formatDate, isDateInMonth, startOfMonth } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { getCurrentSalary, sum } from '../utils/financeSummary'
import {
  analysisObligationsInput,
  buildCalendarEvents,
  calendarEventsCashDelta,
  formatMonth,
  type AnalysisData,
  type CalendarEvent,
} from '../utils/analysisView'
import { activeExpense as activeCardExpense, buildBudgetUsage } from '../utils/budgetAlerts'
import { PRICE_RADAR_MONTHS } from '../data/repositories/analysisRepo'
import { type PriceTrend } from '../utils/priceIncreaseRadar'
import { canCutCurrentStatement } from '../utils/statementCycle'
import { buildFinanceObligationsForMonth } from '../utils/obligations'
import { detectMilestones, type MilestoneInput } from '../utils/milestones'
import { comparePeriods, type ComparisonMode } from '../utils/periodComparison'
import { buildSubscriptionSummary } from '../utils/subscriptions'
import { diffTL, greaterThanTL, sumTL } from '../utils/money'
import { analyzeQuietDays } from '../utils/quietDays'
import { StatPill } from './AnalysisPage.atoms'

export function UpcomingInstallments({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const upcoming = useMemo(() => {
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
    return [...cardItems, ...loanItems]
      .sort((a, b) => a.sortDate.localeCompare(b.sortDate) || b.amount - a.amount)
      .slice(0, 8)
  }, [data.cards, data.loans, data.cardInstallments, data.loanInstallments])

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
                  {formatAmount(item.amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function BudgetProgress({ budgets, expenses }: { budgets: Budget[]; expenses: CardExpense[] }) {
  const { formatAmount } = useBalancePrivacy()
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
                  {formatAmount(budget.spent)} / {formatAmount(budget.limit)}
                </p>
                {isOver ? (
                  <p className="mt-0.5 text-xs font-medium text-destructive">
                    Limit {formatAmount(diffTL(budget.spent, budget.limit))} aşıldı
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

export function FinancialCalendar({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
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
            <p className="mt-1 text-sm text-muted-foreground">{formatMonth(dateInputValue(monthStart))} için nakit etkisi ve karta işlenen yükler.</p>
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
            const dayTotal = calendarEventsCashDelta(dayEvents)

            return (
              <div key={date} className="min-h-[6.25rem] rounded-lg bg-muted/45 p-1.5 ring-1 ring-transparent min-[560px]:min-h-[7rem]">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-foreground">{day}</span>
                  {dayEvents.length > 0 ? (
                    <span className={`hidden text-[10px] font-bold tabular-nums min-[560px]:inline ${dayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {dayTotal >= 0 ? '+' : ''}
                      {formatAmount(dayTotal).replace(',00', '')}
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
              const dayTotal = calendarEventsCashDelta(dayEvents)

              return (
                <div key={`detail-${date}`} className="rounded-lg bg-muted/45 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-foreground">{formatDate(date)}</span>
                    <span className={`shrink-0 font-bold tabular-nums ${dayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {dayTotal >= 0 ? '+' : ''}
                      {formatAmount(dayTotal)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {dayEvents.map((event) => (
                      <div key={`detail-${event.id}`} className="flex min-w-0 items-start justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5">
                        <span className="min-w-0 break-words font-semibold text-foreground">{event.title}</span>
                        <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{formatAmount(event.amount)}</span>
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
      title={`${event.title} - ${formatAmount(event.amount)}`}
      className={`rounded-md px-1.5 py-1 text-[8.5px] font-semibold leading-[1.12] [overflow-wrap:anywhere] min-[560px]:text-[10px] ${toneClass}`}
    >
      {event.title}
    </p>
  )
}

export function PriceIncreaseRadar({ trends }: { trends: PriceTrend[] }) {
  const { formatAmount } = useBalancePrivacy()
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
              {formatAmount(trend.firstAmount)} → {formatAmount(trend.lastAmount)} · {trend.monthsSpan} ayda
              {trend.monthsSpan >= 3 ? ` · yıllık ~%${Math.round(trend.annualizedPct)}` : ''}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function PeopleLedger({ debts }: { debts: Debt[] }) {
  const { formatAmount } = useBalancePrivacy()
  const rows = Array.from(
    debts
      .filter((debt) => debt.status === 'açık')
      .reduce((map, debt) => {
        const current = map.get(debt.person_name) ?? { person: debt.person_name, borrowed: 0, receivable: 0, count: 0 }
        if (debt.direction === 'borç_aldım') current.borrowed = sumTL([current.borrowed, debt.estimated_value_try])
        else current.receivable = sumTL([current.receivable, debt.estimated_value_try])
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
            const net = diffTL(row.receivable, row.borrowed)
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
                  <StatPill label="Alacak" value={formatAmount(row.receivable)} tone="emerald" />
                  <StatPill label="Borç" value={formatAmount(row.borrowed)} tone="rose" />
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

export function MonthCloseAssistant({ data, missingTables }: { data: AnalysisData; missingTables: string[] }) {
  const { formatAmount } = useBalancePrivacy()
  const monthKey = dateInputValue(startOfMonth())
  const today = new Date()
  const currentMonthExpenses = data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at))
  const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  const statementDayPassedCards = creditCards.filter((card) => canCutCurrentStatement(card, data.cardStatementArchives, today))
  const staleInstallments = data.cardInstallments.filter((item) => item.status === 'scheduled' && item.due_month <= monthKey).length
  const currentMonthPaymentIds = new Set(
    buildFinanceObligationsForMonth(analysisObligationsInput(data), startOfMonth())
      .filter((item) => item.kind === 'payment')
      .map((item) => item.sourceId),
  )
  const openPaymentCount = data.payments.filter((payment) => currentMonthPaymentIds.has(payment.id) || (payment.status === 'bekliyor' && (daysUntil(payment.due_date) ?? 0) < 0)).length
  const budgetOverruns = data.budgets.filter((budget) => {
    if (budget.month !== monthKey || budget.limit_amount <= 0) return false
    const spent = sum(
      currentMonthExpenses.filter((expense) => (expense.category || 'Diğer') === budget.category),
      (expense) => expense.amount,
    )
    return greaterThanTL(spent, budget.limit_amount)
  }).length
  const checks = [
    { label: 'Ekstreler kontrol edildi', done: statementDayPassedCards.length === 0, detail: statementDayPassedCards.length > 0 ? `${statementDayPassedCards.length} kart bekliyor` : 'Kesim günü geçmiş açık dönem yok' },
    { label: 'Taksitler işlendi', done: staleInstallments === 0, detail: staleInstallments > 0 ? `${staleInstallments} taksit planlı kaldı` : 'Bu aya kadar planlı taksit yok' },
    { label: 'Maaş kaydı güncel', done: Boolean(getCurrentSalary(data.salaryHistory)), detail: getCurrentSalary(data.salaryHistory) ? formatAmount(getCurrentSalary(data.salaryHistory)?.amount ?? 0) : 'Maaş eklenmedi' },
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

const milestoneIconClass: Record<string, string> = {
  trophy: 'text-amber-500',
  target: 'text-indigo-500',
  shield: 'text-emerald-500',
  'trending-up': 'text-emerald-500',
  zap: 'text-indigo-500',
  star: 'text-amber-500',
}

const milestoneToneClass: Record<string, string> = {
  emerald: 'bg-success/10 ring-success/20',
  amber: 'bg-warning/10 ring-warning/20',
  indigo: 'bg-indigo-500/10 ring-indigo-500/20',
  rose: 'bg-destructive/10 ring-destructive/20',
}

export function MilestonesPanel({ data, snapshots }: { data: AnalysisData; snapshots: NetWorthSnapshot[] }) {
  const input: MilestoneInput = useMemo(() => ({
    assets: data.assets,
    cards: data.cards,
    loans: data.loans,
    cardExpenses: data.cardExpenses,
    savingsGoals: data.savingsGoals,
    netWorthSnapshots: snapshots,
  }), [data, snapshots])

  const milestones = useMemo(() => detectMilestones(input), [input])

  if (milestones.length === 0) return null

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Finansal başarımlar</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{milestones.length} aktif başarım</p>
          </div>
          <Award className="text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {milestones.map((m) => (
          <div key={m.id} className={`rounded-xl px-3 py-2.5 ring-1 ${milestoneToneClass[m.tone] ?? 'bg-muted/45 ring-border/60'}`}>
            <div className="flex items-start gap-2.5">
              <span className={`mt-0.5 text-sm ${milestoneIconClass[m.icon] ?? 'text-muted-foreground'}`}>
                {m.icon === 'trophy' ? '🏆' : m.icon === 'target' ? '🎯' : m.icon === 'shield' ? '🛡️' : m.icon === 'trending-up' ? '📈' : m.icon === 'zap' ? '⚡' : '⭐'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{m.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function QuietDaysPanel({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const result = useMemo(() => analyzeQuietDays(data.cardExpenses, data.transactionHistory), [data.cardExpenses, data.transactionHistory])

  const quietRate = result.totalDaysThisMonth > 0 ? Math.round((result.quietDaysThisMonth / result.totalDaysThisMonth) * 100) : 0
  const lastMonthRate = result.totalDaysLastMonth > 0 ? Math.round((result.quietDaysLastMonth / result.totalDaysLastMonth) * 100) : 0
  const diff = quietRate - lastMonthRate
  const toneClass = diff > 0 ? 'text-success' : diff < 0 ? 'text-destructive' : 'text-muted-foreground'

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Sessiz gün analizi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Harcama yapılmayan günler</p>
          </div>
          <Moon className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Sessiz gün" value={`${result.quietDaysThisMonth}/${result.totalDaysThisMonth}`} tone="emerald" />
          <StatPill label="Seri (şu an)" value={`${result.currentStreak} gün`} tone={result.currentStreak >= 2 ? 'emerald' : 'stone'} />
          <StatPill label="En uzun seri" value={`${result.bestStreakAllTime} gün`} tone="stone" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Bu ay sessiz gün oranı</span>
            <span className="font-bold tabular-nums text-foreground">%{quietRate}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Geçen ay</span>
            <span className="font-bold tabular-nums text-foreground">%{lastMonthRate} ({result.quietDaysLastMonth}/{result.totalDaysLastMonth})</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Değişim</span>
            <span className={`font-bold tabular-nums ${toneClass}`}>
              {diff > 0 ? '+' : ''}{diff} puan
            </span>
          </div>
          {result.avgSpendingOnActiveDay > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Harcama günü ortalaması</span>
              <span className="font-bold tabular-nums text-foreground">{formatAmount(result.avgSpendingOnActiveDay)}</span>
            </div>
          ) : null}
          {result.bestStreakThisMonth >= 2 ? (
            <p className="rounded-xl bg-success/10 px-3 py-2 text-xs font-medium text-success">
              Bu ay en uzun sessiz serin {result.bestStreakThisMonth} gün — harika gidiyorsun!
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function SubscriptionsPanel({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const salary = getCurrentSalary(data.salaryHistory)
  const result = useMemo(
    () => buildSubscriptionSummary(data.cardExpenses, data.payments, salary?.amount ?? null),
    [data.cardExpenses, data.payments, salary],
  )

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Abonelik & sabit giderler</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.items.filter((i) => i.isActive).length} aktif · toplam {formatAmount(result.monthlyTotal)}/ay
              {result.incomeRatio !== null ? ` · gelirin %${result.incomeRatio}'i` : ''}
            </p>
          </div>
          <Repeat className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {result.items.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Tekrarlayan harcama veya ödeme tespit edilmedi.</p>
        ) : (
          result.items.slice(0, 8).map((item) => (
            <div key={item.id} className={`rounded-xl px-3 py-2 text-sm ${item.isActive ? 'bg-muted/45' : 'bg-muted/25 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.category}
                    {item.source === 'recurring_expense' ? ` · ${item.monthCount} aydır tekrarlıyor` : ' · planlı ödeme'}
                    {!item.isActive ? ' · durdurulmuş olabilir' : ''}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-lg bg-muted px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                  {formatAmount(item.amount)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

const comparisonModeLabels: Record<ComparisonMode, string> = {
  month: 'Aylık',
  quarter: 'Çeyreklik',
  year: 'Yıllık',
}

export function PeriodComparisonPanel({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const [mode, setMode] = useState<ComparisonMode>('month')
  const result = useMemo(() => comparePeriods(data.cardExpenses, mode), [data.cardExpenses, mode])

  const changeLabel = result.totalChangePercent === null ? '—' : `${result.totalChangePercent > 0 ? '+' : ''}%${result.totalChangePercent}`

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Dönem karşılaştırması</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{result.currentLabel} vs {result.previousLabel}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            {(['month', 'quarter', 'year'] as ComparisonMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${mode === m ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {comparisonModeLabels[m]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label={result.currentLabel} value={formatAmount(result.currentTotal)} tone="stone" />
          <StatPill label={result.previousLabel} value={formatAmount(result.previousTotal)} tone="stone" />
          <StatPill label="Değişim" value={changeLabel} tone={result.totalChangePercent !== null && result.totalChangePercent <= 0 ? 'emerald' : 'rose'} />
        </div>
        {result.rows.length > 0 ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-1 text-[11px] font-bold uppercase text-muted-foreground">
              <span>Kategori</span>
              <span className="text-right">Şimdi</span>
              <span className="text-right">Önceki</span>
              <span className="text-right">Fark</span>
            </div>
            {result.rows.slice(0, 8).map((row) => (
              <div key={row.category} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">{row.category}</span>
                <span className="shrink-0 whitespace-nowrap text-right font-bold tabular-nums text-foreground">{formatAmount(row.currentAmount)}</span>
                <span className="shrink-0 whitespace-nowrap text-right tabular-nums text-muted-foreground">{formatAmount(row.previousAmount)}</span>
                <span className={`shrink-0 whitespace-nowrap text-right text-xs font-bold tabular-nums ${row.direction === 'down' ? 'text-success' : row.direction === 'up' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {row.changePercent !== null ? `${row.changePercent > 0 ? '+' : ''}%${row.changePercent}` : row.direction === 'new' ? 'Yeni' : '—'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Karşılaştırma için yeterli harcama verisi yok.</p>
        )}
      </CardContent>
    </Card>
  )
}

export function SchemaMigrationNotice({ missingTables }: { missingTables: string[] }) {
  if (missingTables.length === 0) return null

  const optionalTableLabels: Record<string, string> = {
    card_installments: 'kart taksitleri',
    card_statement_archives: 'ekstre arşivi',
    budgets: 'bütçeler',
    savings_goals: 'birikim hedefleri',
  }
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
