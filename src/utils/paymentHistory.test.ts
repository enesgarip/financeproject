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
})
