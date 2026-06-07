import { describe, expect, it } from 'vitest'
import { buildPriceObservations, detectPriceIncreases, type PriceObservation } from './priceIncreaseRadar'
import type { CardExpense, Payment, TransactionHistory } from '../types/database'

const base = { user_id: 'u1', created_at: '2026-01-01', updated_at: '2026-01-01' }

function paymentRow(overrides: Partial<Payment> & { id: string; title: string; category: Payment['category'] }): Payment {
  return {
    ...base,
    amount: 0,
    amount_status: 'exact',
    due_date: '2026-06-01',
    status: 'bekliyor',
    payment_method: 'manual',
    recurrence: 'monthly',
    recurrence_day: 1,
    recurrence_end_date: null,
    note: null,
    ...overrides,
  }
}

function historyRow(overrides: Partial<TransactionHistory> & { id: string }): TransactionHistory {
  return {
    ...base,
    occurred_at: '2026-06-01T00:00:00Z',
    type: 'payment',
    title: 'X odendi',
    amount: 100,
    source_table: 'payments',
    source_id: null,
    note: null,
    ...overrides,
  }
}

function cardExpenseRow(overrides: Partial<CardExpense> & { id: string; spent_at: string; amount: number; description: string }): CardExpense {
  return {
    ...base,
    card_id: 'c1',
    statement_archive_id: null,
    category: 'Market',
    installment_count: 1,
    installment_amount: 0,
    status: 'posted',
    posted_at: overrides.spent_at,
    note: null,
    ...overrides,
  }
}

function obs(
  key: string,
  date: string,
  amount: number,
  extra: Partial<PriceObservation> = {},
): PriceObservation {
  return { key, label: extra.label ?? key, category: extra.category ?? null, amount, date }
}

describe('detectPriceIncreases', () => {
  it('flags a rent that crept up over six months', () => {
    const observations = [
      obs('rent', '2026-01-05', 10000, { label: 'Kira', category: 'Kira / aidat' }),
      obs('rent', '2026-02-05', 10000, { label: 'Kira', category: 'Kira / aidat' }),
      obs('rent', '2026-03-05', 12000, { label: 'Kira', category: 'Kira / aidat' }),
      obs('rent', '2026-04-05', 12000, { label: 'Kira', category: 'Kira / aidat' }),
      obs('rent', '2026-05-05', 13500, { label: 'Kira', category: 'Kira / aidat' }),
      obs('rent', '2026-06-05', 15000, { label: 'Kira', category: 'Kira / aidat' }),
    ]
    const [trend] = detectPriceIncreases(observations)
    expect(trend).toBeDefined()
    expect(trend!.label).toBe('Kira')
    expect(trend!.category).toBe('Kira / aidat')
    expect(trend!.firstAmount).toBe(10000)
    expect(trend!.lastAmount).toBe(15000)
    expect(trend!.firstMonth).toBe('2026-01')
    expect(trend!.lastMonth).toBe('2026-06')
    expect(trend!.monthsSpan).toBe(5)
    expect(trend!.changePct).toBeCloseTo(50)
    expect(trend!.monthCount).toBe(6)
    // (1.5)^(12/5) - 1 ≈ 1.646 → ~164.6 %
    expect(trend!.annualizedPct).toBeCloseTo(164.6, 0)
  })

  it('ignores items below the change threshold', () => {
    const observations = [
      obs('sub', '2026-01-01', 100),
      obs('sub', '2026-02-01', 100),
      obs('sub', '2026-03-01', 105), // +5 % only
    ]
    expect(detectPriceIncreases(observations)).toHaveLength(0)
  })

  it('respects the minMonths floor', () => {
    const observations = [
      obs('sub', '2026-01-01', 100),
      obs('sub', '2026-06-01', 200),
    ]
    expect(detectPriceIncreases(observations)).toHaveLength(0)
    expect(detectPriceIncreases(observations, { minMonths: 2 })).toHaveLength(1)
  })

  it('requires a minimum month span (rejects same-quarter spikes)', () => {
    const observations = [
      obs('x', '2026-06-01', 100),
      obs('x', '2026-06-10', 130),
      obs('x', '2026-06-20', 160),
    ]
    // 3 observations but all in one month → span 0
    expect(detectPriceIncreases(observations)).toHaveLength(0)
  })

  it('does not report decreases', () => {
    const observations = [
      obs('y', '2026-01-01', 500),
      obs('y', '2026-02-01', 450),
      obs('y', '2026-03-01', 400),
    ]
    expect(detectPriceIncreases(observations)).toHaveLength(0)
  })

  it('uses the median within a month to resist one-off spikes', () => {
    const observations = [
      obs('z', '2026-01-01', 200),
      obs('z', '2026-02-01', 200),
      // March has a refund-then-recharge: median is 240, not the 9999 outlier
      obs('z', '2026-03-01', 240),
      obs('z', '2026-03-15', 9999),
      obs('z', '2026-03-20', 240),
    ]
    const [trend] = detectPriceIncreases(observations)
    expect(trend!.lastAmount).toBe(240)
    expect(trend!.changePct).toBeCloseTo(20)
  })

  it('skips non-positive and non-finite amounts', () => {
    const observations = [
      obs('a', '2026-01-01', 0),
      obs('a', '2026-02-01', Number.NaN),
      obs('a', '2026-03-01', 100),
      obs('a', '2026-04-01', 150),
    ]
    // Only two valid months remain → below minMonths
    expect(detectPriceIncreases(observations)).toHaveLength(0)
  })

  it('sorts multiple trends by total change descending', () => {
    const observations = [
      obs('big', '2026-01-01', 100, { label: 'Big' }),
      obs('big', '2026-02-01', 150, { label: 'Big' }),
      obs('big', '2026-03-01', 300, { label: 'Big' }), // +200 %
      obs('small', '2026-01-01', 100, { label: 'Small' }),
      obs('small', '2026-02-01', 110, { label: 'Small' }),
      obs('small', '2026-03-01', 120, { label: 'Small' }), // +20 %
    ]
    const trends = detectPriceIncreases(observations)
    expect(trends.map((t) => t.label)).toEqual(['Big', 'Small'])
  })
})

describe('buildPriceObservations', () => {
  it('groups payment history by source_id and resolves label/category', () => {
    const payments = [paymentRow({ id: 'p1', title: 'Kira', category: 'Kira / aidat' })]
    const transactionHistory = [
      historyRow({ id: 'h1', source_id: 'p1', title: 'Kira odendi', amount: 12000, occurred_at: '2026-05-01T00:00:00Z' }),
      historyRow({ id: 'h2', source_id: 'p1', title: 'Kira odendi', amount: 13000, occurred_at: '2026-06-01T00:00:00Z' }),
    ]
    const result = buildPriceObservations({ transactionHistory, payments, cardExpenses: [] })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ key: 'pay:p1', label: 'Kira', category: 'Kira / aidat', amount: 12000 })
  })

  it('falls back to a cleaned title key when source_id is missing', () => {
    const transactionHistory = [historyRow({ id: 'h1', source_id: null, title: 'Netflix odendi', amount: 200 })]
    const [observation] = buildPriceObservations({ transactionHistory, payments: [], cardExpenses: [] })
    expect(observation!.key).toBe('paytitle:netflix')
    expect(observation!.label).toBe('Netflix')
    expect(observation!.category).toBeNull()
  })

  it('skips non-payment history rows and null amounts', () => {
    const transactionHistory = [
      historyRow({ id: 'h1', type: 'transfer', amount: 999 }),
      historyRow({ id: 'h2', type: 'payment', amount: null }),
    ]
    expect(buildPriceObservations({ transactionHistory, payments: [], cardExpenses: [] })).toHaveLength(0)
  })

  it('includes posted non-installment card expenses keyed by description', () => {
    const cardExpenses = [
      cardExpenseRow({ id: 'e1', spent_at: '2026-05-10', amount: 150, description: 'Spotify', category: 'Dijital üyelik' }),
      cardExpenseRow({ id: 'e2', spent_at: '2026-06-10', amount: 165, description: 'Spotify', category: 'Dijital üyelik' }),
      cardExpenseRow({ id: 'e3', spent_at: '2026-06-11', amount: 500, description: 'Taksitli', installment_count: 3 }),
      cardExpenseRow({ id: 'e4', spent_at: '2026-06-12', amount: 80, description: 'İptal', status: 'cancelled' }),
    ]
    const result = buildPriceObservations({ transactionHistory: [], payments: [], cardExpenses })
    expect(result).toHaveLength(2)
    expect(result.every((r) => r.key === 'card:spotify')).toBe(true)
  })

  it('feeds end-to-end into detectPriceIncreases', () => {
    const payments = [paymentRow({ id: 'p1', title: 'Kira', category: 'Kira / aidat' })]
    const transactionHistory = [
      historyRow({ id: 'h1', source_id: 'p1', title: 'Kira odendi', amount: 10000, occurred_at: '2025-07-01T00:00:00Z' }),
      historyRow({ id: 'h2', source_id: 'p1', title: 'Kira odendi', amount: 10000, occurred_at: '2025-12-01T00:00:00Z' }),
      historyRow({ id: 'h3', source_id: 'p1', title: 'Kira odendi', amount: 15000, occurred_at: '2026-06-01T00:00:00Z' }),
    ]
    const observations = buildPriceObservations({ transactionHistory, payments, cardExpenses: [] })
    const [trend] = detectPriceIncreases(observations)
    expect(trend!.label).toBe('Kira')
    expect(trend!.changePct).toBeCloseTo(50)
  })
})
