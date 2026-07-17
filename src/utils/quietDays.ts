/**
 * "Sessiz gün" analizi: harcama yapılmayan günleri ve serileri sayar — harcama
 * disiplinini oyunlaştıran bir metrik. Bu ayki/geçen ayki sessiz gün sayısı,
 * devam eden seri, bu ayın/tüm zamanların en uzun serisi ve harcama yapılan
 * günlerin ortalaması. "posted" harcamalar + işlem geçmişi birlikte değerlendirilir.
 */
import type { CardExpense, TransactionHistory } from '../types/database'
import { sumTL } from './money'
import { normalizeSearchText } from './searchText'

export type QuietDaysResult = {
  /** Bu ay harcama yapılmayan gün sayısı */
  quietDaysThisMonth: number
  /** Bu aydaki toplam geçen gün sayısı */
  totalDaysThisMonth: number
  /** Devam eden sessiz gün serisi (bugün dahil, sıfır olabilir) */
  currentStreak: number
  /** Bu aydaki en uzun sessiz gün serisi */
  bestStreakThisMonth: number
  /** Tüm verideki en uzun sessiz gün serisi */
  bestStreakAllTime: number
  /** Geçen aydaki sessiz gün sayısı (karşılaştırma için) */
  quietDaysLastMonth: number
  /** Geçen aydaki toplam gün sayısı */
  totalDaysLastMonth: number
  /** Bu aydaki günlük ortalama harcama (harcama yapılan günler) */
  avgSpendingOnActiveDay: number
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildSpendingDaySet(
  expenses: CardExpense[],
  transactionHistory: TransactionHistory[],
): Map<string, number> {
  const dayTotals = new Map<string, number>()

  for (const e of expenses) {
    if (e.status !== 'posted') continue
    const key = e.spent_at.slice(0, 10)
    dayTotals.set(key, sumTL([dayTotals.get(key), e.amount]))
  }

  for (const t of transactionHistory) {
    if (t.type !== 'payment' || !t.amount || t.amount <= 0) continue
    // Kart ekstresi/borcu ödemesi yeni tüketim değildir; kart harcaması zaten
    // harcama tarihinde sayılmıştır. Planlı ödeme karta yazıldıysa aynı eylem
    // card_expenses'ta da bulunduğundan history satırını ikinci kez toplama.
    if (t.source_table === 'card_statement_archives' || t.source_table === 'cards') continue
    if (t.source_table === 'payments' && normalizeSearchText(t.note).includes('kredi kart')) continue
    const key = t.occurred_at.slice(0, 10)
    dayTotals.set(key, sumTL([dayTotals.get(key), t.amount]))
  }

  return dayTotals
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function countQuietDays(
  dayTotals: Map<string, number>,
  year: number,
  month: number,
  upToDay?: number,
): number {
  const maxDay = upToDay ?? daysInMonth(year, month)
  let count = 0
  for (let d = 1; d <= maxDay; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!dayTotals.has(key)) count++
  }
  return count
}

function longestStreak(
  dayTotals: Map<string, number>,
  year: number,
  month: number,
  upToDay?: number,
): number {
  const maxDay = upToDay ?? daysInMonth(year, month)
  let best = 0
  let current = 0
  for (let d = 1; d <= maxDay; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!dayTotals.has(key)) {
      current++
      if (current > best) best = current
    } else {
      current = 0
    }
  }
  return best
}

function currentStreakFromToday(dayTotals: Map<string, number>, today: Date): number {
  let streak = 0
  const d = new Date(today)
  while (true) {
    const key = dateKey(d)
    if (dayTotals.has(key)) break
    streak++
    d.setDate(d.getDate() - 1)
    if (d.getFullYear() < today.getFullYear() - 1) break
  }
  return streak
}

function allTimeStreak(dayTotals: Map<string, number>, today: Date): number {
  const keys = [...dayTotals.keys()].sort()
  if (keys.length === 0) return 0
  const firstDate = new Date(`${keys[0]}T00:00:00`)
  let best = 0
  let current = 0
  const d = new Date(firstDate)
  while (d <= today) {
    const key = dateKey(d)
    if (!dayTotals.has(key)) {
      current++
      if (current > best) best = current
    } else {
      current = 0
    }
    d.setDate(d.getDate() + 1)
  }
  return best
}

export function analyzeQuietDays(
  expenses: CardExpense[],
  transactionHistory: TransactionHistory[],
  now: Date = new Date(),
): QuietDaysResult {
  const dayTotals = buildSpendingDaySet(expenses, transactionHistory)

  const year = now.getFullYear()
  const month = now.getMonth()
  const todayDay = now.getDate()

  const quietDaysThisMonth = countQuietDays(dayTotals, year, month, todayDay)
  const bestStreakThisMonth = longestStreak(dayTotals, year, month, todayDay)

  const prevMonth = month === 0 ? 11 : month - 1
  const prevYear = month === 0 ? year - 1 : year
  const totalDaysLastMonth = daysInMonth(prevYear, prevMonth)
  const quietDaysLastMonth = countQuietDays(dayTotals, prevYear, prevMonth)

  const currentStreak = currentStreakFromToday(dayTotals, now)
  const bestStreakAllTime = allTimeStreak(dayTotals, now)

  let activeDayCount = 0
  let activeDayTotal = 0
  for (let d = 1; d <= todayDay; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const amount = dayTotals.get(key)
    if (amount) {
      activeDayCount++
      activeDayTotal = sumTL([activeDayTotal, amount])
    }
  }

  return {
    quietDaysThisMonth,
    totalDaysThisMonth: todayDay,
    currentStreak,
    bestStreakThisMonth,
    bestStreakAllTime,
    quietDaysLastMonth,
    totalDaysLastMonth,
    avgSpendingOnActiveDay: activeDayCount > 0 ? activeDayTotal / activeDayCount : 0,
  }
}
