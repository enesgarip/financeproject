import type { CarServiceInput } from '../types/database'

export type CarServiceAttempt = { id: string; input: CarServiceInput }
const key = (userId: string, reminderId: string) => `denge:car-service-attempt:v1:${userId}:${reminderId}`

export function readCarServiceAttempt(userId: string, reminderId: string): CarServiceAttempt | null {
  const raw = localStorage.getItem(key(userId, reminderId))
  if (!raw) return null
  const parsed = JSON.parse(raw) as CarServiceAttempt
  const input = parsed?.input
  const isNullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(parsed?.id ?? '') || !input || input.reminderId !== reminderId
    || !['none', 'card', 'existing_manual', 'manual'].includes(input.expenseMode) || !['nakit', 'banka', 'diger'].includes(input.paymentMethod)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.completedOn) || typeof input.expectedUpdatedAt !== 'string'
    || !(input.nextDate === null || /^\d{4}-\d{2}-\d{2}$/.test(input.nextDate))
    || !(input.expectedDueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(input.expectedDueDate)) || !isNullableNumber(input.expectedDueKm)
    || !(input.existingExpenseId === null || typeof input.existingExpenseId === 'string')
    || !isNullableNumber(input.amount) || !isNullableNumber(input.odometerKm) || !isNullableNumber(input.nextKm)) {
    throw new Error('Önceki bakım işlemi okunamadı. Yeni kayıt girmeden tamamlanan işleri kontrol et.')
  }
  return parsed
}

export function saveCarServiceAttempt(userId: string, attempt: CarServiceAttempt) {
  localStorage.setItem(key(userId, attempt.input.reminderId), JSON.stringify(attempt))
}

export function clearCarServiceAttempt(userId: string, reminderId: string) {
  try { localStorage.removeItem(key(userId, reminderId)) } catch { /* Kalan anahtar yalnız eski makbuzu doğrular. */ }
}
