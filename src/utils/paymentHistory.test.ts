import { describe, expect, it } from 'vitest'
import type { TransactionHistory } from '../types/database'
import { paidPaymentIdsInMonth } from './paymentHistory'

function history(overrides: Partial<TransactionHistory> = {}): TransactionHistory {
  return {
    id: 'history-1',
    user_id: 'user-1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    occurred_at: '2026-07-10T12:00:00Z',
    type: 'payment',
    title: 'Fatura ödendi',
    amount: 500,
    source_table: 'payments',
    source_id: 'payment-1',
    source_event_id: null,
    note: null,
    ...overrides,
  }
}

describe('paidPaymentIdsInMonth', () => {
  it('counts only actual payment history rows in the selected month', () => {
    const result = paidPaymentIdsInMonth([
      history(),
      history({ id: 'old', source_id: 'payment-2', occurred_at: '2026-06-30T12:00:00Z' }),
      history({ id: 'statement', source_table: 'card_statement_archives', source_id: 'statement-1' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual(['payment-1'])
  })

  it('ay sınırını aşan geri almayı görür (31 Temmuz ödendi → 1 Ağustos geri alındı)', () => {
    const result = paidPaymentIdsInMonth([
      history({ occurred_at: '2026-07-31T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-08-01T09:00:00Z', title: 'Fatura ödemesi geri alındı' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual([])
  })

  it('geri alma penceresi kapandıktan sonra ayın sonucunu değiştirmez', () => {
    const result = paidPaymentIdsInMonth([
      history({ occurred_at: '2026-07-31T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-08-25T09:00:00Z', title: 'Fatura ödemesi geri alındı' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual(['payment-1'])
  })

  it('sonraki ayda yeniden ödenip geri alınan tekrarlı ödeme bu ayı etkilemez', () => {
    const result = paidPaymentIdsInMonth([
      history({ occurred_at: '2026-07-05T09:00:00Z' }),
      history({ id: 'august', occurred_at: '2026-08-05T09:00:00Z' }),
      history({ id: 'undo', occurred_at: '2026-08-06T09:00:00Z', title: 'Fatura ödemesi geri alındı' }),
    ], new Date(2026, 6, 18))

    expect([...result]).toEqual(['payment-1'])
  })
})
