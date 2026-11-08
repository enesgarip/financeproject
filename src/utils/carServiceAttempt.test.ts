// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest'
import { clearCarServiceAttempt, readCarServiceAttempt, saveCarServiceAttempt, type CarServiceAttempt } from './carServiceAttempt'
import { clearUserPaymentAttempts } from './paymentAttempt'

const attempt: CarServiceAttempt = { id: '11111111-1111-4111-8111-111111111111', input: {
  reminderId: 'reminder', expectedUpdatedAt: '2026-11-08T12:00:00Z', expectedDueDate: '2026-11-08', expectedDueKm: null,
  completedOn: '2026-11-08', odometerKm: null, nextDate: null, nextKm: null, expenseMode: 'manual', existingExpenseId: null, amount: 750, paymentMethod: 'nakit',
} }
beforeEach(() => localStorage.clear())

it('kullanıcı/hatırlatıcı kapsamını ve boş bırakılan sonraki planı aynen korur', () => {
  saveCarServiceAttempt('u1', attempt)
  expect(readCarServiceAttempt('u1', 'reminder')).toEqual(attempt)
  expect(readCarServiceAttempt('u2', 'reminder')).toBeNull()
  expect(readCarServiceAttempt('u1', 'other')).toBeNull()
  clearCarServiceAttempt('u1', 'reminder')
  expect(readCarServiceAttempt('u1', 'reminder')).toBeNull()
})
it('bozuk veya farklı hatırlatıcıya ait kaydı yeni işlem diye göndermeyi reddeder', () => {
  const key = 'denge:car-service-attempt:v1:u1:reminder'
  for (const value of ['null', '{broken', JSON.stringify({ ...attempt, input: { ...attempt.input, reminderId: 'other' } })]) {
    localStorage.setItem(key, value)
    expect(() => readCarServiceAttempt('u1', 'reminder')).toThrow()
  }
})
it('reset/restore yalnız aynı kullanıcının bekleyen bakım niyetini temizler', () => {
  saveCarServiceAttempt('u1', attempt); saveCarServiceAttempt('u2', attempt)
  clearUserPaymentAttempts('u1')
  expect(readCarServiceAttempt('u1', 'reminder')).toBeNull()
  expect(readCarServiceAttempt('u2', 'reminder')).toEqual(attempt)
})
