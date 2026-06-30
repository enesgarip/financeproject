/**
 * İki dönemi kategori bazında karşılaştırır (ay↔ay, çeyrek↔çeyrek, yıl↔yıl).
 * Her kategori için bu dönem vs önceki dönem tutarı + yüzde değişim + yön
 * (up/down/same/new). Önceki dönemde olmayan kategori 'new' işaretlenir
 * (yüzde hesaplanamaz). Saf; AnalysisPage karşılaştırma panelinde kullanılır.
 */
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

function toISO(date: Date): string {
  return date.toLocaleDateString('sv-SE')
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(date)
}

function quarterLabel(year: number, q: number): string {
  return `${year} Q${q}`
}

export type ComparisonMode = 'month' | 'quarter' | 'year'

type PeriodBounds = { start: Date; end: Date; label: string }

/**
 * Fair period-over-period comparison: the current period is only partway through,
 * so the prior period is clipped to the SAME number of elapsed days from its
 * start. Comparing a running current period against a full prior one would
 * understate the change early in the period. When the current period is still
 * open both labels carry an "ilk N gün" note so the side-by-side totals are honest.
 */
function buildPeriods(currentBounds: PeriodBounds, prevBounds: PeriodBounds, now: Date): [PeriodDef, PeriodDef] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const elapsedDays = Math.max(0, daysBetween(currentBounds.start, today)) // 0-indexed offset
  const dayCount = elapsedDays + 1
  const partial = today < currentBounds.end

  const currentTo = today < currentBounds.end ? today : currentBounds.end
  const prevToRaw = addDays(prevBounds.start, elapsedDays)
  const prevTo = prevToRaw < prevBounds.end ? prevToRaw : prevBounds.end

  const suffix = partial ? ` · ilk ${dayCount} gün` : ''
  return [
    { label: `${currentBounds.label}${suffix}`, from: toISO(currentBounds.start), to: toISO(currentTo) },
    { label: `${prevBounds.label}${suffix}`, from: toISO(prevBounds.start), to: toISO(prevTo) },
  ]
}

function getMonthPeriods(now: Date): [PeriodDef, PeriodDef] {
  const y = now.getFullYear()
  const m = now.getMonth()
  return buildPeriods(
    { start: new Date(y, m, 1), end: new Date(y, m + 1, 0), label: monthLabel(new Date(y, m, 1)) },
    { start: new Date(y, m - 1, 1), end: new Date(y, m, 0), label: monthLabel(new Date(y, m - 1, 1)) },
    now,
  )
}

function getQuarterPeriods(now: Date): [PeriodDef, PeriodDef] {
  const q = Math.floor(now.getMonth() / 3) + 1
  const y = now.getFullYear()
  const startMonth = (q - 1) * 3
  const prevQ = q === 1 ? 4 : q - 1
  const prevY = q === 1 ? y - 1 : y
  const prevStartMonth = (prevQ - 1) * 3
  return buildPeriods(
    { start: new Date(y, startMonth, 1), end: new Date(y, startMonth + 3, 0), label: quarterLabel(y, q) },
    { start: new Date(prevY, prevStartMonth, 1), end: new Date(prevY, prevStartMonth + 3, 0), label: quarterLabel(prevY, prevQ) },
    now,
  )
}

function getYearPeriods(now: Date): [PeriodDef, PeriodDef] {
  const y = now.getFullYear()
  return buildPeriods(
    { start: new Date(y, 0, 1), end: new Date(y, 11, 31), label: String(y) },
    { start: new Date(y - 1, 0, 1), end: new Date(y - 1, 11, 31), label: String(y - 1) },
    now,
  )
}

function inPeriod(spentAt: string, period: PeriodDef): boolean {
  const d = spentAt.slice(0, 10)
  return d >= period.from && d <= period.to
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
