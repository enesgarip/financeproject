import { CalendarDays } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { formatDate } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { buildFinancialPosition } from '../utils/financeSummary'
import { buildFullMonthCalendar, type CalendarDay } from '../utils/fullMonthCalendar'
import { analysisObligationsInput, analysisFinanceSummaryInput, type AnalysisData } from '../utils/analysisView'
import { StatPill } from './AnalysisPage.atoms'

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

const toneBg: Record<string, string> = {
  emerald: 'bg-success/8 ring-success/20',
  rose: 'bg-destructive/8 ring-destructive/20',
  amber: 'bg-warning/8 ring-warning/20',
  neutral: 'bg-muted/45 ring-transparent',
}

const toneText: Record<string, string> = {
  emerald: 'text-success',
  rose: 'text-destructive',
  amber: 'text-warning',
  neutral: 'text-muted-foreground',
}

function DayCell({ day, onSelect, isSelected }: { day: CalendarDay; onSelect: (day: CalendarDay) => void; isSelected: boolean }) {
  const hasEvents = day.events.length > 0

  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      className={`relative flex min-h-[5.5rem] flex-col rounded-lg p-1.5 text-left ring-1 transition-all min-[560px]:min-h-[6.5rem] ${toneBg[day.tone]} ${isSelected ? 'ring-2 ring-foreground/30' : ''} ${day.isToday ? 'ring-2 ring-foreground/50' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`text-xs font-bold ${day.isToday ? 'rounded-md bg-foreground px-1.5 py-0.5 text-background' : day.isPast ? 'text-muted-foreground' : 'text-foreground'}`}>
          {day.dayOfMonth}
        </span>
        {hasEvents && day.netCashImpact !== 0 ? (
          <span className={`hidden text-[10px] font-bold tabular-nums min-[560px]:inline ${toneText[day.tone]}`}>
            {day.netCashImpact > 0 ? '+' : ''}{formatAmount(day.netCashImpact).replace(',00', '')}
          </span>
        ) : null}
      </div>
      {hasEvents ? (
        <div className="mt-1 flex flex-col gap-0.5">
          {day.events.slice(0, 2).map((event) => (
            <p
              key={event.id}
              className={`truncate rounded-md px-1 py-0.5 text-[8px] font-semibold leading-tight min-[560px]:text-[10px] ${event.direction === 'inflow' ? 'bg-success/12 text-success' : event.settlement === 'credit_card' ? 'bg-muted text-muted-foreground' : 'bg-destructive/12 text-destructive'}`}
            >
              {event.title}
            </p>
          ))}
          {day.events.length > 2 ? (
            <p className="text-[10px] font-semibold text-muted-foreground">+{day.events.length - 2}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-auto pt-1">
        <p className={`text-[9px] font-bold tabular-nums min-[560px]:text-[10px] ${day.projectedBalance >= 0 ? 'text-muted-foreground/60' : 'text-destructive/70'}`}>
          {formatAmount(day.projectedBalance).replace(',00', '')}
        </p>
      </div>
    </button>
  )
}

function DayDetail({ day }: { day: CalendarDay }) {
  if (day.events.length === 0) {
    return (
      <div className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">
        <p className="font-bold text-foreground">{formatDate(day.date)}</p>
        <p className="mt-1">Bu günde yükümlülük veya gelir yok.</p>
        <p className="mt-1 text-xs">Tahmini bakiye: {formatAmount(day.projectedBalance)}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-muted/45 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-foreground">{formatDate(day.date)}</p>
        <span className={`text-xs font-bold tabular-nums ${day.netCashImpact >= 0 ? 'text-success' : 'text-destructive'}`}>
          Net: {day.netCashImpact >= 0 ? '+' : ''}{formatAmount(day.netCashImpact)}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {day.events.map((event) => (
          <div key={event.id} className="flex items-start justify-between gap-2 rounded-lg bg-background/70 px-2.5 py-1.5 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{event.title}</p>
              <p className="mt-0.5 text-muted-foreground">
                {event.direction === 'inflow' ? 'Gelir' : event.settlement === 'credit_card' ? 'Kart yükü' : 'Nakit çıkışı'}
                {event.settlement === 'credit_card' ? ' · nakit etkisi yok' : ' · nakit'}
              </p>
            </div>
            <span className={`shrink-0 font-bold tabular-nums ${event.direction === 'inflow' ? 'text-success' : 'text-destructive'}`}>
              {event.direction === 'inflow' ? '+' : '-'}{formatAmount(event.amount)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Gün sonu tahmini bakiye: <span className={`font-bold ${day.projectedBalance >= 0 ? 'text-foreground' : 'text-destructive'}`}>{formatAmount(day.projectedBalance)}</span>
      </p>
    </div>
  )
}

export function FullMonthCalendarPanel({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)

  const calendar = useMemo(() => {
    const position = buildFinancialPosition(analysisFinanceSummaryInput(data))
    return buildFullMonthCalendar(
      analysisObligationsInput(data),
      data.cardExpenses,
      data.salaryHistory,
      position.totalCashAssets,
    )
  }, [data])

  const todayDay = calendar.days.find((d) => d.isToday)

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Nakit akış takvimi — {calendar.monthLabel}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Günlük bakiye projeksiyonu · {calendar.quietDayCount} sessiz gün
              {calendar.salaryDay ? ` · maaş günü: ${calendar.salaryDay}` : ''}
            </p>
          </div>
          <CalendarDays className="text-success" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-4">
          <StatPill label="Başlangıç bakiye" value={formatAmount(calendar.startBalance)} tone="stone" />
          <StatPill label="Gelir" value={formatAmount(calendar.totalIncome)} tone="emerald" />
          <StatPill label="Nakit çıkışı" value={formatAmount(calendar.totalExpense)} tone="rose" />
          <StatPill label="Ay sonu tahmini" value={formatAmount(calendar.endBalance)} tone={calendar.endBalance >= 0 ? 'emerald' : 'rose'} />
        </div>

        <div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-7 gap-1.5">
            {Array.from({ length: calendar.firstWeekdayOffset }, (_, i) => (
              <div key={`empty-${i}`} className="min-h-[5.5rem] min-[560px]:min-h-[6.5rem]" />
            ))}
            {calendar.days.map((day) => (
              <DayCell
                key={day.date}
                day={day}
                onSelect={setSelectedDay}
                isSelected={selectedDay?.date === day.date}
              />
            ))}
          </div>
        </div>

        {calendar.weeks.length > 0 ? (
          <div className="grid gap-1.5 min-[520px]:grid-cols-2 min-[900px]:grid-cols-4 lg:grid-cols-5">
            {calendar.weeks.map((week) => (
              <div key={week.weekNumber} className="flex items-center justify-between gap-2 rounded-lg bg-muted/45 px-3 py-2 text-xs">
                <span className="font-bold text-muted-foreground">{week.weekNumber}. hafta</span>
                <span className={`font-bold tabular-nums ${week.weeklyNetFlow >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {week.weeklyNetFlow >= 0 ? '+' : ''}{formatAmount(week.weeklyNetFlow)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {selectedDay ? (
          <DayDetail day={selectedDay} />
        ) : todayDay ? (
          <DayDetail day={todayDay} />
        ) : null}
      </CardContent>
    </Card>
  )
}
