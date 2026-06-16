import {
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  HandCoins,
  Landmark,
  WalletCards,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../../lib/utils'
import { dateInputValue, formatDate, isDateInMonth, startOfMonth } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { sumTL } from '../../utils/money'
import {
  buildFinanceObligationsForMonth,
  groupFinanceObligationsByDate,
  summarizeFinanceObligations,
  type FinanceObligation,
  type FinanceObligationsInput,
} from '../../utils/obligations'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Skeleton } from '../ui/skeleton'

type ObligationsCalendarProps = {
  data: FinanceObligationsInput
  loading?: boolean
  onPayObligation?: (obligation: FinanceObligation) => void
}

const WEEK_DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const MONTH_LABEL = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })

function addDays(value: Date, days: number) {
  const next = new Date(value)
  next.setDate(value.getDate() + days)
  return next
}

function addCalendarMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1)
}

function buildCalendarCells(month: Date) {
  const firstDay = startOfMonth(month)
  const mondayOffset = (firstDay.getDay() + 6) % 7
  const firstCell = addDays(firstDay, -mondayOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(firstCell, index)
    return {
      date,
      key: dateInputValue(date),
      inCurrentMonth: isDateInMonth(date, month),
    }
  })
}

function obligationKindLabel(item: FinanceObligation) {
  if (item.kind === 'payment') return 'Planlı'
  if (item.kind === 'card_statement') return 'Ekstre'
  if (item.kind === 'card_debt') return 'Kart'
  if (item.kind === 'card_installment') return 'Taksit'
  if (item.kind === 'loan_installment') return 'Kredi'
  if (item.kind === 'legacy_loan_installment') return 'Kredi'
  if (item.kind === 'personal_receivable') return 'Tahsilat'
  return 'Borç'
}

function obligationActionLabel(item: FinanceObligation) {
  if (item.action === 'collect_debt') return 'Tahsil et'
  if (item.action === 'pay_card_statement') return 'Ekstre öde'
  if (item.action === 'pay_card_debt') return 'Kart öde'
  if (item.action === 'pay_loan_installment') return 'Taksit öde'
  if (item.action === 'settle_debt') return 'Borcu öde'
  if (item.action === 'pay_payment') return 'Öde'
  return 'Bilgi'
}

function obligationBadgeVariant(item: FinanceObligation): 'default' | 'destructive' | 'success' | 'warning' | 'info' | 'secondary' {
  if (item.direction === 'inflow') return 'success'
  if (item.kind === 'card_statement' || item.kind === 'card_debt' || item.kind === 'personal_debt') return 'destructive'
  if (item.kind === 'card_installment' || item.kind === 'legacy_loan_installment') return 'warning'
  if (item.kind === 'loan_installment') return 'info'
  return 'default'
}

function obligationIcon(item: FinanceObligation) {
  if (item.kind === 'payment') return WalletCards
  if (item.kind === 'card_statement' || item.kind === 'card_debt' || item.kind === 'card_installment') return CreditCard
  if (item.kind === 'loan_installment' || item.kind === 'legacy_loan_installment') return Landmark
  if (item.kind === 'personal_debt' || item.kind === 'personal_receivable') return HandCoins
  return Banknote
}

function dayTotals(items: FinanceObligation[]) {
  return {
    outflow: sumTL(items.filter((item) => item.direction === 'outflow').map((item) => item.amount)),
    inflow: sumTL(items.filter((item) => item.direction === 'inflow').map((item) => item.amount)),
  }
}

function SummaryStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' | 'success' }) {
  const toneClass = tone === 'danger' ? 'text-destructive' : tone === 'success' ? 'text-success' : 'text-foreground'

  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
      <p className="finance-label truncate">{label}</p>
      <p className={cn('finance-value mt-1 truncate text-sm font-black tabular-nums', toneClass)}>{value}</p>
    </div>
  )
}

export function ObligationsCalendar({ data, loading = false, onPayObligation }: ObligationsCalendarProps) {
  const today = dateInputValue(new Date())
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(today)
  const selectedDateInMonth = isDateInMonth(selectedDate, visibleMonth) ? selectedDate : dateInputValue(startOfMonth(visibleMonth))
  const obligations = useMemo(() => buildFinanceObligationsForMonth(data, visibleMonth), [data, visibleMonth])
  const groupedByDate = useMemo(() => groupFinanceObligationsByDate(obligations), [obligations])
  const summary = useMemo(() => summarizeFinanceObligations(obligations), [obligations])
  const cells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth])
  const selectedItems = groupedByDate.get(selectedDateInMonth) ?? []

  function moveMonth(offset: number) {
    const nextMonth = addCalendarMonths(visibleMonth, offset)
    setVisibleMonth(nextMonth)
    setSelectedDate(dateInputValue(startOfMonth(nextMonth)))
  }

  function jumpToToday() {
    const now = new Date()
    setVisibleMonth(startOfMonth(now))
    setSelectedDate(dateInputValue(now))
  }

  return (
    <Card variant="elevated" className="overflow-hidden">
      <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-primary via-warning to-success opacity-80" />
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="finance-label">Planlı Yük Takvimi</p>
            <CardTitle className="mt-1 flex min-w-0 items-center gap-2 text-lg">
              <CalendarDays className="size-5 text-primary" />
              <span className="truncate capitalize">{MONTH_LABEL.format(visibleMonth)}</span>
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon-sm" onClick={() => moveMonth(-1)} aria-label="Önceki ay">
              <ChevronLeft />
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={jumpToToday}>
              Bugün
            </Button>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => moveMonth(1)} aria-label="Sonraki ay">
              <ChevronRight />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 min-[720px]:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 rounded-lg" />)}
            </div>
            <Skeleton className="h-[28rem] rounded-lg" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 min-[720px]:grid-cols-4">
              <SummaryStat label="Ay yükü" value={formatCurrency(summary.outflow)} tone="danger" />
              <SummaryStat label="Beklenen giriş" value={formatCurrency(summary.inflow)} tone="success" />
              <SummaryStat label="Net etki" value={`${summary.net < 0 ? '−' : ''}${formatCurrency(Math.abs(summary.net))}`} tone={summary.net >= 0 ? 'success' : 'danger'} />
              <SummaryStat label="Aksiyon" value={`${summary.payableCount}/${summary.itemCount}`} />
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-black uppercase text-muted-foreground sm:gap-2">
              {WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
            </div>

            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {cells.map((cell) => {
                const dayItems = groupedByDate.get(cell.key) ?? []
                const totals = dayTotals(dayItems)
                const isSelected = cell.key === selectedDateInMonth
                const isToday = cell.key === today
                const hasItems = dayItems.length > 0

                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => setSelectedDate(cell.key)}
                    className={cn(
                      'flex h-[5.25rem] min-w-0 flex-col rounded-lg border p-1.5 text-left transition sm:h-28 sm:p-2',
                      cell.inCurrentMonth ? 'border-border/60 bg-card hover:border-primary/35 hover:bg-muted/35' : 'border-border/35 bg-muted/20 opacity-55',
                      isSelected && 'border-primary bg-primary/10 ring-2 ring-primary/15',
                      isToday && !isSelected && 'border-info/50',
                    )}
                  >
                    <span className={cn('text-xs font-black tabular-nums', isToday ? 'text-info' : 'text-foreground')}>
                      {cell.date.getDate()}
                    </span>
                    {hasItems ? (
                      <span className="mt-auto flex min-w-0 flex-col gap-1">
                        <span className="truncate text-[10px] font-bold tabular-nums text-destructive sm:text-xs">
                          {totals.outflow > 0 ? formatCurrency(totals.outflow) : totals.inflow > 0 ? formatCurrency(totals.inflow) : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <span className={cn('size-1.5 rounded-full', totals.outflow > 0 ? 'bg-destructive' : 'bg-success')} />
                          <span className="truncate text-[10px] font-semibold text-muted-foreground">{dayItems.length} kayıt</span>
                        </span>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            <section className="rounded-lg border border-border/70 bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="finance-label">Seçili gün</p>
                  <h3 className="mt-1 text-base font-black text-foreground">{formatDate(selectedDateInMonth)}</h3>
                </div>
                <Badge variant={selectedItems.length > 0 ? 'default' : 'outline'}>{selectedItems.length} kayıt</Badge>
              </div>

              {selectedItems.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-border/70 bg-card/70 px-3 py-4 text-sm font-medium text-muted-foreground">
                  Bu güne bağlı planlı yük yok.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {selectedItems.map((item) => {
                    const Icon = obligationIcon(item)
                    return (
                      <article key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/65 bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="min-w-0 truncate text-sm font-black text-foreground">{item.title}</h4>
                              <Badge variant={obligationBadgeVariant(item)}>{obligationKindLabel(item)}</Badge>
                              {item.isEstimate ? <Badge variant="outline">Tahmini</Badge> : null}
                            </div>
                            <p className="mt-1 text-xs font-medium text-muted-foreground">{item.subtitle}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                          <span className={cn('finance-value text-sm font-black tabular-nums', item.direction === 'inflow' ? 'text-success' : 'text-foreground')}>
                            {item.direction === 'inflow' ? '+' : ''}{formatCurrency(item.amount)}
                          </span>
                          {item.action && onPayObligation ? (
                            <Button type="button" size="sm" variant={item.direction === 'inflow' ? 'success' : 'default'} onClick={() => onPayObligation(item)}>
                              {obligationActionLabel(item)}
                            </Button>
                          ) : (
                            <Badge variant="secondary">{obligationActionLabel(item)}</Badge>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}
