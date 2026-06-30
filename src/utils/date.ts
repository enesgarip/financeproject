/**
 * Tarih yardımcıları (saf). Uygulamadaki tüm tarih hesabı buradan geçer;
 * tutarlı timezone/locale davranışı için elle `new Date()` aritmetiği yapma.
 *
 * İki tuzak:
 *  - YYYY-MM-DD string'leri yerelde gün kayması yaşamasın diye hep `T00:00:00`
 *    ekleyerek parse ediyoruz (UTC yerine yerel gün başı).
 *  - `dateInMonth` ay taşmasını güvenli yapar: 31 Şubat istenirse o ayın son
 *    gününe kırpar (Math.min). Aylık tekrarlı ödeme tarihleri bunu kullanır.
 *  - `dateInputValue` 'sv-SE' locale ile YYYY-MM-DD üretir (input[type=date] formatı).
 */
export function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

export function nextMonthlyDate(day: number | null | undefined) {
  return nextMonthlyDateFrom(day, startOfToday())
}

export function nextMonthlyDateFrom(day: number | null | undefined, from: Date) {
  if (!day) return null
  let target = dateInMonth(from.getFullYear(), from.getMonth(), day)
  if (target < startOfDay(from)) {
    target = dateInMonth(from.getFullYear(), from.getMonth() + 1, day)
  }
  return target
}

export function daysUntil(value: Date | string | null | undefined) {
  if (!value) return null
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  const ms = date.getTime() - startOfToday().getTime()
  return Math.ceil(ms / 86_400_000)
}

export function startOfToday() {
  return startOfDay(new Date())
}

export function isUpcomingDate(value: string | null | undefined, days = 30) {
  const remaining = daysUntil(value)
  return remaining !== null && remaining >= 0 && remaining <= days
}

export function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function startOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

export function endOfMonth(value = new Date()) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0)
}

export function dateInputValue(date: Date | null | undefined) {
  return date ? date.toLocaleDateString('sv-SE') : ''
}

export function addMonths(value: Date, months: number) {
  return dateInMonth(value.getFullYear(), value.getMonth() + months, value.getDate())
}

export function isDateInMonth(value: Date | string | null | undefined, month = new Date()) {
  if (!value) return false
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  return date >= startOfMonth(month) && date <= endOfMonth(month)
}

export function monthlyOccurrenceDate(day: number | null | undefined, month = new Date()) {
  if (!day) return null
  return dateInMonth(month.getFullYear(), month.getMonth(), day)
}

export function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days)
}

export function dateInMonth(year: number, month: number, day: number) {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay))
}
