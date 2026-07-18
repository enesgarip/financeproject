import { describe, expect, it } from 'vitest'
import type { CardExpense, TransactionHistory } from '../types/database'
import { analyzeQuietDays } from './quietDays'

const base = {
  id: 'row-1',
  user_id: 'user-1',
  created_at: '2026-07-10T12:00:00Z',
  updated_at: '2026-07-10T12:00:00Z',
}

function expense(amount: number): CardExpense {
  return {
    ...base,
    card_id: 'card-1',
    statement_archive_id: null,
    spent_at: '2026-07-10',
    amount,
    description: 'İnternet faturası',
    category: 'Fatura',
    installment_count: 1,
    installment_amount: amount,
    status: 'posted',
    posted_at: '2026-07-10T12:00:00Z',
    note: null,
    transaction_fingerprint: null,
  }
}

function payment(note: string, source_table = 'payments'): TransactionHistory {
  return {
    ...base,
    occurred_at: '2026-07-10T12:00:00Z',
    type: 'payment',
    title: 'İnternet ödendi',
    amount: 500,
    source_table,
    source_id: 'payment-1',
    note,
  }
}

describe('analyzeQuietDays', () => {
  it('returns consistent zero streaks when there is no observed spending history', () => {
    const result = analyzeQuietDays([], [], new Date(2026, 6, 10))
    expect(result.currentStreak).toBe(0)
    expect(result.bestStreakAllTime).toBe(0)
  })

  it('does not double count a planned payment posted to a credit card', () => {
    const result = analyzeQuietDays(
      [expense(500)],
      [payment('Bonus kredi kartına harcama olarak işlendi.')],
      new Date(2026, 6, 10),
    )

    expect(result.avgSpendingOnActiveDay).toBe(500)
  })

  it('still counts a bank-funded planned payment', () => {
    const result = analyzeQuietDays([], [payment('Vadesiz hesabından ödendi.')], new Date(2026, 6, 10))
    expect(result.avgSpendingOnActiveDay).toBe(500)
  })

  it('does not treat a card statement payment as fresh spending', () => {
    const result = analyzeQuietDays([], [payment('Hesaptan ödendi.', 'card_statement_archives')], new Date(2026, 6, 10))
    expect(result.avgSpendingOnActiveDay).toBe(0)
  })
})
