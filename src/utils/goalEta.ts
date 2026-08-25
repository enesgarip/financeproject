/**
 * Hedef varış tahmini (saf): günlük hedef fotoğraflarından (PR-0,
 * savings_goal_snapshots) GERÇEKLEŞEN tempoyu çıkarır ve "bu gidişle ne zaman
 * biter?" sorusuna cevap verir.
 *
 * İki dürüstlük kuralı (wishlistPlan çizgisi):
 *  - Yeterli tarihçe yoksa (45 günden kısa süre ya da 2 farklı aya yayılmayan
 *    örnek) tempo HİÇ konuşmaz — iki günlük seriden aylık hız uydurulmaz.
 *  - Tempo sıfır/negatifse varış tarihi UYDURULMAZ (tempo satırı yine görünür;
 *    kaynağa bağlı hedefte piyasa düşüşü de dürüstçe "ayda −X" der).
 *
 * Tutarlar hedefin KENDİ birimindedir (fotoğraf öyle yazılır): TRY hedefte TL,
 * gram/çeyrek hedefte miktar. Karma hedefte fotoğraf "ulaşan bileşen sayısı"
 * olduğu için tempo anlamsızdır — çağıran karma hedefte bu modülü atlamalı.
 */
import type { SavingsGoal, SavingsGoalSnapshot } from '../types/database'
import { addDays, addMonths, dateInputValue, startOfMonth } from './date'
import { roundTL } from './money'

/** buildSavingsSuggestion ile aynı ay uzunluğu (30,44 gün). */
const DAYS_PER_MONTH = 30.44
const WINDOW_DAYS = 90
const MIN_SPAN_DAYS = 45
/** 10 yılın ötesine tarih vermek tahmin değil fal olurdu. */
const MAX_ETA_MONTHS = 120

export type GoalTempo = {
  /** Aylık gerçekleşen değişim, hedefin kendi biriminde (negatif olabilir). */
  monthlyDelta: number
  /** İlk ve son fotoğraf arasındaki gün sayısı. */
  spanDays: number
}

type SnapshotRow = Pick<SavingsGoalSnapshot, 'goal_id' | 'snapshot_date' | 'amount'>

function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * Son 90 günün fotoğraflarından aylık tempo. Delikli seri sorun değil (uç
 * noktalar yeter); tek koşul yeterli SÜRE ve en az iki farklı aya yayılım.
 */
export function buildGoalTempo(
  snapshots: SnapshotRow[],
  goalId: string,
  today: Date = new Date(),
): GoalTempo | null {
  const windowStart = dateInputValue(addDays(today, -WINDOW_DAYS))
  const rows = snapshots
    .filter((row) => row.goal_id === goalId && row.snapshot_date >= windowStart)
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (rows.length < 2) return null

  const first = rows[0]
  const last = rows[rows.length - 1]
  const spanDays = diffDays(parseDay(first.snapshot_date), parseDay(last.snapshot_date))
  if (spanDays < MIN_SPAN_DAYS) return null

  const distinctMonths = new Set(rows.map((row) => row.snapshot_date.slice(0, 7)))
  if (distinctMonths.size < 2) return null

  return {
    monthlyDelta: roundTL(((last.amount - first.amount) / spanDays) * DAYS_PER_MONTH),
    spanDays,
  }
}

export type GoalEta = {
  /** Bugünden tahmini bitişe kalan ay (en az 1). */
  months: number
  /** Tahmini bitiş ayı ("Mart 2028"). */
  etaLabel: string
  /** target_date varsa: pozitif = planın ÖNÜNDE (erken biter), negatif = geride. */
  deltaMonthsVsTarget: number | null
}

function monthIndex(value: Date): number {
  return value.getFullYear() * 12 + value.getMonth()
}

export function buildGoalEta(
  goal: Pick<SavingsGoal, 'target_date'>,
  remaining: number,
  tempo: GoalTempo | null,
  today: Date = new Date(),
): GoalEta | null {
  if (!tempo || tempo.monthlyDelta <= 0) return null
  if (remaining <= 0) return null

  const months = Math.max(1, Math.ceil(remaining / tempo.monthlyDelta))
  if (months > MAX_ETA_MONTHS) return null

  const etaDate = addMonths(startOfMonth(today), months)
  const etaLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(etaDate)
  const deltaMonthsVsTarget = goal.target_date
    ? monthIndex(parseDay(goal.target_date)) - monthIndex(etaDate)
    : null

  return { months, etaLabel, deltaMonthsVsTarget }
}
