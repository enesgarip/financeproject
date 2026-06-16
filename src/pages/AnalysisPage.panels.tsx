import { CalendarDays, CheckCircle2, TrendingUp, Users, WalletCards } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import type { Budget, CardExpense, Debt } from '../types/database'
import { dateInputValue, daysUntil, formatDate, isDateInMonth, startOfMonth } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
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
import { diffTL, greaterThanTL, sumTL } from '../utils/money'
import { StatPill } from './AnalysisPage.atoms'

export function UpcomingInstallments({ data }: { data: AnalysisData }) {
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

export function BudgetProgress({ budgets, expenses }: { budgets: Budget[]; expenses: CardExpense[] }) {
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
                    Limit {formatCurrency(diffTL(budget.spent, budget.limit))} aşıldı
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
              const dayTotal = calendarEventsCashDelta(dayEvents)

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

export function PriceIncreaseRadar({ trends }: { trends: PriceTrend[] }) {
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

export function PeopleLedger({ debts }: { debts: Debt[] }) {
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

export function MonthCloseAssistant({ data, missingTables }: { data: AnalysisData; missingTables: string[] }) {
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
