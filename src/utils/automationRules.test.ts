import { expect, it } from 'vitest'
import { paymentOccurrenceIso } from '../../supabase/functions/_shared/automationRules'
import { paymentOccurrenceInMonth } from './financeObligationRules'
import type { Payment } from '../types/database'

const plan = { status: 'bekliyor', due_date: '2026-10-31', recurrence: 'monthly', recurrence_day: 31, recurrence_end_date: null } as Payment
it.each([
  ['2026-11-01', '2026-11-30'], ['2027-02-01', '2027-02-28'],
  ['2028-02-01', '2028-02-29'], ['2026-09-01', null],
])('UI ve edge %s ayındaki aynı gerçek tekrarı bulur', (month, expected) => {
  expect(paymentOccurrenceIso(plan, month)).toBe(expected)
  expect(paymentOccurrenceInMonth(plan, new Date(`${month}T12:00:00`))?.toLocaleDateString('sv-SE') ?? null).toBe(expected)
})
it('plan bitişi, başlangıcı, durumu ve tek seferli kayıt aynı sözleşmeyi kullanır', () => {
  expect(paymentOccurrenceIso({ ...plan, recurrence_end_date: '2026-11-29' }, '2026-11-01')).toBeNull()
  expect(paymentOccurrenceIso({ ...plan, status: 'ödendi' }, '2026-11-01')).toBeNull()
  expect(paymentOccurrenceIso({ ...plan, recurrence: 'none' }, '2026-11-01')).toBeNull()
  expect(paymentOccurrenceIso({ ...plan, recurrence_day: null }, '2026-11-01')).toBeNull()
})
