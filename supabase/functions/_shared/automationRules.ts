/** UI ve edge'in paylaştığı, saat diliminden bağımsız otomasyon kuralları. */
export type RecurringPayment = {
  status: string
  due_date: string
  recurrence: string | null
  recurrence_day: number | null
  recurrence_end_date: string | null
}

export function paymentOccurrenceIso(payment: RecurringPayment, monthIso: string): string | null {
  if (payment.status !== 'bekliyor') return null
  if (payment.recurrence !== 'monthly') return payment.due_date.startsWith(monthIso.slice(0, 7)) ? payment.due_date : null
  const day = payment.recurrence_day
  if (!day || !Number.isInteger(day) || day < 1 || day > 31) return null
  const [year, month] = monthIso.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const date = `${monthIso.slice(0, 7)}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  return date < payment.due_date || (payment.recurrence_end_date && date > payment.recurrence_end_date) ? null : date
}

export type SalaryEvent = { kind: string; occurred_at: string; amount_kurus: number }

const istDayFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' })
export function salaryEventDay(value: string): string {
  // date-only veriler zaten yerel gün; timestamp offsetleri aynı İstanbul gününe katlanır.
  return value.length === 10 ? value : istDayFormatter.format(new Date(value))
}

/** Tutar tek başına maaş kanıtı değildir; eşit çıkışlı girişleri ihtiyatla ele. */
export function salaryDepositCandidates<T extends SalaryEvent>(events: T[]): T[] {
  const outflows = new Set(events.filter(e => e.amount_kurus < 0).map(e => `${salaryEventDay(e.occurred_at)}:${Math.abs(e.amount_kurus)}`))
  return events.filter(e => e.kind === 'deposit' && e.amount_kurus > 0 && !outflows.has(`${salaryEventDay(e.occurred_at)}:${e.amount_kurus}`))
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
}
