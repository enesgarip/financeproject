/**
 * Tam ay nakit akış takvimi: bir ayın her gününe yükümlülükleri (obligations.ts)
 * yerleştirir ve gün gün ilerleyen projekte bakiyeyi hesaplar.
 *
 * Her gün için giriş/çıkış, net nakit etkisi (cashImpact bazlı) ve o güne kadarki
 * projekte bakiye tutulur; bakiyenin negatife döndüğü günler "rose" tonuyla
 * işaretlenir. Haftalara da bölünür (takvim grid'i için firstWeekdayOffset ile).
 */
import type { CardExpense, SalaryHistory } from '../types/database'
import { dateInputValue, startOfMonth } from './date'
import {
  buildFinanceObligationsForMonth,
  type FinanceObligation,
  type FinanceObligationsInput,
} from './obligations'
import { getSalaryForDate } from './financeSummary'
import { diffTL, roundTL, sumTL } from './money'

export type CalendarDayEvent = {
  id: string
  title: string
  amount: number
  direction: 'inflow' | 'outflow'
  settlement: 'cash' | 'credit_card'
  kind: string
}

export type CalendarDay = {
  date: string
  dayOfMonth: number
  isToday: boolean
  isPast: boolean
  events: CalendarDayEvent[]
  totalInflow: number
  totalOutflow: number
  netCashImpact: number
  projectedBalance: number
  tone: 'emerald' | 'rose' | 'amber' | 'neutral'
}

export type CalendarWeek = {
  weekNumber: number
  days: CalendarDay[]
  weeklyNetFlow: number
}

export type FullMonthCalendarResult = {
  monthLabel: string
  monthStart: Date
  daysInMonth: number
  firstWeekdayOffset: number
  days: CalendarDay[]
  weeks: CalendarWeek[]
  totalIncome: number
  totalExpense: number
  netFlow: number
  startBalance: number
  endBalance: number
  salaryDay: number | null
  salaryAmount: number
  busiestDay: CalendarDay | null
  quietDayCount: number
}

function firstBusinessDayOfMonth(year: number, monthIndex: number): number {
  for (let d = 1; d <= 7; d++) {
    const dow = new Date(year, monthIndex, d).getDay()
    if (dow >= 1 && dow <= 5) return d
  }
  return 1
}

function buildDayEvents(obligations: FinanceObligation[], date: string): CalendarDayEvent[] {
  return obligations
    .filter((o) => o.date === date)
    .map((o) => ({
      id: o.id,
      title: o.title,
      amount: o.amount,
      direction: o.direction,
      settlement: o.settlement ?? 'cash',
      kind: o.kind,
    }))
}

export function buildFullMonthCalendar(
  obligationsInput: FinanceObligationsInput,
  expenses: CardExpense[],
  salaryHistory: SalaryHistory[],
  cashBalance: number,
  now: Date = new Date(),
): FullMonthCalendarResult {
  const month = startOfMonth(now)
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const firstWeekdayOffset = (month.getDay() + 6) % 7

  const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(month)

  const obligations = buildFinanceObligationsForMonth(obligationsInput, month)

  const salary = getSalaryForDate(salaryHistory, new Date(year, monthIndex + 1, 0))
  const salaryAmount = salary?.amount ?? 0
  const salaryDay = salary ? firstBusinessDayOfMonth(year, monthIndex) : null

  const todayStr = dateInputValue(now)

  const posted = expenses.filter(
    (e) => e.status === 'posted' && e.spent_at.slice(0, 7) === `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
  )

  const expenseByDay = new Map<string, number>()
  for (const e of posted) {
    const d = e.spent_at.slice(0, 10)
    expenseByDay.set(d, sumTL([expenseByDay.get(d), e.amount]))
  }

  let runningBalance = roundTL(cashBalance)
  const days: CalendarDay[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const isPast = dateStr < todayStr
    const isToday = dateStr === todayStr

    const events = buildDayEvents(obligations, dateStr)

    const isSalaryDay = salaryDay !== null && d === Math.min(salaryDay, daysInMonth)
    if (isSalaryDay && salaryAmount > 0 && !events.some((e) => e.kind === 'salary')) {
      events.unshift({
        id: `salary-${dateStr}`,
        title: 'Maaş',
        amount: salaryAmount,
        direction: 'inflow',
        settlement: 'cash',
        kind: 'salary',
      })
    }

    // cashBalance bugünün güncel bakiyesidir. Geçmiş olayları (ve bugün zaten
    // bakiyeye yansımış maaşı) yeniden uygulamak ay sonunu çift saydırır.
    const projectedEvents = isPast
      ? []
      : events.filter((event) => !(isToday && event.kind === 'salary'))

    let totalInflow = 0
    let totalOutflow = 0

    for (const event of projectedEvents) {
      if (event.settlement !== 'cash') continue
      if (event.direction === 'inflow') totalInflow = sumTL([totalInflow, event.amount])
      else totalOutflow = sumTL([totalOutflow, event.amount])
    }

    const netCashImpact = diffTL(totalInflow, totalOutflow)
    runningBalance = sumTL([runningBalance, netCashImpact])

    const tone: CalendarDay['tone'] =
      events.length === 0 ? 'neutral'
      : netCashImpact > 0 ? 'emerald'
      : netCashImpact < -1000 ? 'rose'
      : netCashImpact < 0 ? 'amber'
      : 'neutral'

    days.push({
      date: dateStr,
      dayOfMonth: d,
      isToday,
      isPast,
      events,
      totalInflow,
      totalOutflow,
      netCashImpact,
      projectedBalance: runningBalance,
      tone,
    })
  }

  const weeks: CalendarWeek[] = []
  let currentWeek: CalendarDay[] = []
  let weekNumber = 1

  for (const day of days) {
    currentWeek.push(day)
    const dayOfWeek = new Date(`${day.date}T00:00:00`).getDay()
    if (dayOfWeek === 0 || day.dayOfMonth === daysInMonth) {
      const weeklyNetFlow = sumTL(currentWeek.map((d) => d.netCashImpact))
      weeks.push({ weekNumber, days: [...currentWeek], weeklyNetFlow })
      currentWeek = []
      weekNumber++
    }
  }

  const totalIncome = sumTL(days.map((d) => d.totalInflow))
  const totalExpense = sumTL(days.map((d) => d.totalOutflow))
  const netFlow = roundTL(totalIncome - totalExpense)

  const busiestDay = days.reduce<CalendarDay | null>((best, day) => {
    if (day.events.length === 0) return best
    if (!best || day.events.length > best.events.length) return day
    return best
  }, null)

  const quietDayCount = days.filter((d) => d.isPast && d.events.length === 0 && !expenseByDay.has(d.date)).length

  return {
    monthLabel,
    monthStart: month,
    daysInMonth,
    firstWeekdayOffset,
    days,
    weeks,
    totalIncome,
    totalExpense,
    netFlow,
    startBalance: roundTL(cashBalance),
    endBalance: runningBalance,
    salaryDay,
    salaryAmount,
    busiestDay,
    quietDayCount,
  }
}
