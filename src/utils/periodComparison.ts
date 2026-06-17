import type { CardExpense } from '../types/database'
import { sumTL } from './money'

export type PeriodComparisonRow = {
  category: string
  currentAmount: number
  previousAmount: number
  changePercent: number | null
  direction: 'up' | 'down' | 'same' | 'new'
}

export type PeriodComparisonResult = {
  currentLabel: string
  previousLabel: string
  currentTotal: number
  previousTotal: number
  totalChangePercent: number | null
  rows: PeriodComparisonRow[]
}

type PeriodDef = { label: string; from: string; to: string }

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${key}-01T00:00:00`))
}

function quarterLabel(year: number, q: number): string {
  return `${year} Q${q}`
}

export type ComparisonMode = 'month' | 'quarter' | 'year'

function getMonthPeriods(now: Date): [PeriodDef, PeriodDef] {
  const current = monthKey(now)
  const prev = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  return [
    { label: monthLabel(current), from: current, to: current },
    { label: monthLabel(prev), from: prev, to: prev },
  ]
}

function getQuarterPeriods(now: Date): [PeriodDef, PeriodDef] {
  const q = Math.floor(now.getMonth() / 3) + 1
  const y = now.getFullYear()
  const startMonth = (q - 1) * 3
  const currentFrom = monthKey(new Date(y, startMonth, 1))
  const currentTo = monthKey(new Date(y, startMonth + 2, 1))

  const prevQ = q === 1 ? 4 : q - 1
  const prevY = q === 1 ? y - 1 : y
  const prevStart = (prevQ - 1) * 3
  const prevFrom = monthKey(new Date(prevY, prevStart, 1))
  const prevTo = monthKey(new Date(prevY, prevStart + 2, 1))

  return [
    { label: quarterLabel(y, q), from: currentFrom, to: currentTo },
    { label: quarterLabel(prevY, prevQ), from: prevFrom, to: prevTo },
  ]
}

function getYearPeriods(now: Date): [PeriodDef, PeriodDef] {
  const y = now.getFullYear()
  return [
    { label: String(y), from: `${y}-01`, to: `${y}-12` },
    { label: String(y - 1), from: `${y - 1}-01`, to: `${y - 1}-12` },
  ]
}

function inPeriod(spentAt: string, period: PeriodDef): boolean {
  const m = spentAt.slice(0, 7)
  return m >= period.from && m <= period.to
}

export function comparePeriods(
  expenses: CardExpense[],
  mode: ComparisonMode = 'month',
  now: Date = new Date(),
): PeriodComparisonResult {
  const [currentPeriod, previousPeriod] =
    mode === 'quarter' ? getQuarterPeriods(now)
    : mode === 'year' ? getYearPeriods(now)
    : getMonthPeriods(now)

  const posted = expenses.filter((e) => e.status !== 'cancelled')

  const currentByCategory = new Map<string, number>()
  const previousByCategory = new Map<string, number>()
  let currentTotal = 0
  let previousTotal = 0

  for (const e of posted) {
    const cat = e.category || 'Diğer'
    if (inPeriod(e.spent_at, currentPeriod)) {
      currentByCategory.set(cat, sumTL([currentByCategory.get(cat), e.amount]))
      currentTotal = sumTL([currentTotal, e.amount])
    } else if (inPeriod(e.spent_at, previousPeriod)) {
      previousByCategory.set(cat, sumTL([previousByCategory.get(cat), e.amount]))
      previousTotal = sumTL([previousTotal, e.amount])
    }
  }

  const allCategories = new Set([...currentByCategory.keys(), ...previousByCategory.keys()])
  const rows: PeriodComparisonRow[] = [...allCategories].map((category) => {
    const currentAmount = currentByCategory.get(category) ?? 0
    const previousAmount = previousByCategory.get(category) ?? 0
    const changePercent = previousAmount > 0
      ? Math.round(((currentAmount - previousAmount) / previousAmount) * 100)
      : null
    const direction: PeriodComparisonRow['direction'] =
      previousAmount === 0 ? 'new'
      : currentAmount > previousAmount ? 'up'
      : currentAmount < previousAmount ? 'down'
      : 'same'
    return { category, currentAmount, previousAmount, changePercent, direction }
  }).sort((a, b) => b.currentAmount - a.currentAmount)

  const totalChangePercent = previousTotal > 0
    ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100)
    : null

  return {
    currentLabel: currentPeriod.label,
    previousLabel: previousPeriod.label,
    currentTotal,
    previousTotal,
    totalChangePercent,
    rows,
  }
}
