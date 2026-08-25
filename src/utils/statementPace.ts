/**
 * Ekstre dönemi harcama temposu (saf).
 *
 * "Bu dönem ₺X harcadın" tek başına yönsüz bir sayı; anlamı, GEÇEN dönemin
 * aynı gününe kıyasla ortaya çıkar. İki taraf da card_expenses'ten hesaplanır —
 * kartın "Dönem içi" borç kovasıyla (current_period_spending) kaynak
 * KARIŞTIRILMAZ: kova iade/düzeltme de içerir; kıyasın iki yakası farklı
 * kaynaktan gelirse delta uydurma çıkar.
 *
 * Dil bilinçli NÖTR: dönem harcamasının yüksek olması her zaman kötü değildir
 * (yıllık sigorta, tatil ayı); satır sinyal rengi almaz, yalnız bilgi verir.
 * Önceki dönemde hiç satır yoksa kıyas UYDURULMAZ (yeni kart / veri yok → null).
 */
import type { Card, CardExpense } from '../types/database'
import { getCardStatementPeriod } from './cardStatement'
import { addDays, dateInputValue, startOfDay } from './date'
import { greaterThanTL, roundTL, sumTL } from './money'

export type StatementPaceExpense = Pick<CardExpense, 'card_id' | 'amount' | 'status' | 'spent_at'>

export type StatementPace = {
  /** Cari dönem başından bugüne (dahil) aktif harcama toplamı. */
  current: number
  /** Önceki dönemin aynı gün-offset'ine kadar olan toplamı. */
  previous: number
  /** Yüzde fark (yuvarlanmış); önceki taraf 0 ise oran anlamsız → null. */
  deltaPct: number | null
  /** Dönemin kaçıncı günündeyiz (1-bazlı). */
  daysIntoPeriod: number
  periodLabel: string
}

function parseDay(value: string): Date {
  return startOfDay(new Date(`${value}T00:00:00`))
}

function diffDays(from: Date, to: Date): number {
  // startOfDay'li tarihlerle DST kayması yarım saatlik kalır; round emer.
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/** spent_at date kolonudur ama timestamptz sızarsa gün kıyası bozulmasın. */
function dayOf(value: string): string {
  return value.slice(0, 10)
}

export function buildStatementPace(
  card: Pick<Card, 'id' | 'card_type' | 'statement_day' | 'due_day'>,
  expenses: StatementPaceExpense[],
  today: Date = new Date(),
): StatementPace | null {
  const period = getCardStatementPeriod(card, today)
  if (!period) return null

  const todayDate = startOfDay(today)
  const daysIntoPeriod = diffDays(parseDay(period.periodStart), todayDate) + 1

  // Önceki dönem = dönem başının bir önceki gününün dönemi.
  const previousPeriod = getCardStatementPeriod(card, addDays(parseDay(period.periodStart), -1))
  if (!previousPeriod) return null

  // Aynı gün-offset'i; önceki dönem daha kısaysa (Şubat gibi) sonuna kıstırılır.
  const sameDayCutoff = addDays(parseDay(previousPeriod.periodStart), daysIntoPeriod - 1)
  const previousEnd = parseDay(previousPeriod.periodEnd)
  const previousCutoffValue = dateInputValue(sameDayCutoff <= previousEnd ? sameDayCutoff : previousEnd)

  const active = expenses.filter((row) => row.card_id === card.id && row.status !== 'cancelled')
  const todayValue = dateInputValue(todayDate)
  const currentRows = active.filter((row) => dayOf(row.spent_at) >= period.periodStart && dayOf(row.spent_at) <= todayValue)
  const previousRows = active.filter(
    (row) => dayOf(row.spent_at) >= previousPeriod.periodStart && dayOf(row.spent_at) <= previousCutoffValue,
  )
  if (previousRows.length === 0) return null

  const current = roundTL(sumTL(currentRows.map((row) => row.amount)))
  const previous = roundTL(sumTL(previousRows.map((row) => row.amount)))
  const deltaPct = greaterThanTL(previous, 0) ? Math.round(((current - previous) / previous) * 100) : null

  return { current, previous, deltaPct, daysIntoPeriod, periodLabel: period.periodLabel }
}
