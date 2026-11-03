// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest'
import { clearUserPaymentAttempts, readPaymentAttempt, savePaymentAttempt } from './paymentAttempt'
import type { FinanceObligation } from './obligations'

beforeEach(() => localStorage.clear())
it('bekleyen ödeme kullanıcı ve kaynak kapsamındadır; sıfırlama diğer kullanıcıyı temizlemez', () => {
  const intent = { action: 'settle_debt', sourceId: 'debt' } as FinanceObligation
  const attempt = { id: crypto.randomUUID(), accountId: 'bank', amount: 100, obligationAmount: 1000, skipSourceDebit: false }
  savePaymentAttempt('u1', intent, attempt)
  expect(readPaymentAttempt('u2', intent)).toBeNull()
  expect(readPaymentAttempt('u1', { ...intent, sourceId: 'other' })).toBeNull()
  savePaymentAttempt('u2', intent, { ...attempt, id: crypto.randomUUID() })
  clearUserPaymentAttempts('u1')
  expect(readPaymentAttempt('u1', intent)).toBeNull()
  expect(readPaymentAttempt('u2', intent)?.amount).toBe(100)
})
it('bozuk yerel niyeti yeni ödeme gibi göndermek yerine durdurur', () => {
  localStorage.setItem('denge:payment-attempt:v1:u1:settle_debt:debt', 'null')
  expect(() => readPaymentAttempt('u1', { action: 'settle_debt', sourceId: 'debt' } as FinanceObligation)).toThrow('Önceki ödeme kaydı okunamadı')
})
