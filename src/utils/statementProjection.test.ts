import { describe, expect, it } from 'vitest'
import type { Card, CardExpense, CardInstallment, Payment } from '../types/database'
import type { SubscriptionItem } from './subscriptions'
import { discretionaryMonthlyBase, projectUpcomingStatements } from './statementProjection'

const TODAY = new Date(2026, 7, 20) // 20 Ağustos 2026

const card = {
  id: 'c1',
  card_type: 'kredi_karti',
  statement_day: 15,
  due_day: 25,
  current_period_spending: 4000,
} as Pick<Card, 'id' | 'card_type' | 'statement_day' | 'due_day' | 'current_period_spending'>

function installment(over: Partial<CardInstallment>): CardInstallment {
  return {
    id: 'i',
    user_id: 'u',
    created_at: '',
    updated_at: '',
    card_id: 'c1',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 6,
    due_month: '2026-09-01',
    amount: 0,
    description: 'Taksit',
    category: 'Diğer',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    ...over,
  }
}

function subscription(over: Partial<SubscriptionItem>): SubscriptionItem {
  return {
    id: 's',
    source: 'recurring_expense',
    title: 'Netflix',
    category: 'Dijital üyelik',
    amount: 230,
    monthCount: 4,
    isActive: true,
    sourceCardId: 'c1',
    recurrenceDay: 12,
    ...over,
  }
}

function payment(over: Partial<Payment>): Payment {
  return {
    id: 'p',
    user_id: 'u',
    created_at: '',
    updated_at: '',
    title: 'Talimat',
    category: 'Fatura',
    amount: 700,
    amount_status: 'exact',
    due_date: '2026-09-05',
    status: 'bekliyor',
    payment_method: 'bank_auto',
    recurrence: 'monthly',
    recurrence_day: 5,
    recurrence_end_date: null,
    auto_source_card_id: 'c1',
    note: null,
    ...over,
  }
}

describe('projectUpcomingStatements', () => {
  const installments = [
    installment({ id: 'i1', due_month: '2026-09-01', amount: 1200 }),
    installment({ id: 'i2', due_month: '2026-10-01', amount: 800 }),
    installment({ id: 'baska-kart', card_id: 'c2', due_month: '2026-09-01', amount: 999 }),
    installment({ id: 'kesilmis', due_month: '2026-09-01', amount: 500, status: 'posted' }),
  ]
  const subscriptions = [
    subscription({ id: 's1' }),
    subscription({ id: 'baska-kart', sourceCardId: 'c2', amount: 999 }),
    subscription({ id: 'pasif', isActive: false, amount: 999 }),
    subscription({ id: 'plan-kaynakli', source: 'recurring_payment', sourceCardId: null, amount: 999 }),
  ]
  const payments = [payment({ id: 'p1' }), payment({ id: 'manuel', payment_method: 'manual', amount: 999 })]

  it('chains three cut periods and keeps k=0 free of recurring medians', () => {
    const rows = projectUpcomingStatements(card, installments, subscriptions, payments, TODAY)
    expect(rows.map((row) => row.statementDate)).toEqual(['2026-09-15', '2026-10-15', '2026-11-15'])
    // k=0: E3 formülü — kova + o ayın taksidi; abonelik ÇİFT SAYILMAZ.
    expect(rows[0]).toMatchObject({ currentPeriod: 4000, installmentTotal: 1200, recurringTotal: 0, amount: 5200, dueDate: '2026-09-25' })
    // k=1: taksit + (abonelik 230 + talimat 700).
    expect(rows[1]).toMatchObject({ currentPeriod: 0, installmentTotal: 800, recurringTotal: 930, amount: 1730 })
    expect(rows[2]).toMatchObject({ installmentTotal: 0, recurringTotal: 930, amount: 930 })
    expect(rows[0]!.monthLabel).toContain('Eylül')
  })

  it('returns empty for cards without a statement schedule', () => {
    expect(projectUpcomingStatements({ ...card, statement_day: null }, [], [], [], TODAY)).toEqual([])
    expect(projectUpcomingStatements({ ...card, card_type: 'banka_karti' }, [], [], [], TODAY)).toEqual([])
  })
})

describe('discretionaryMonthlyBase', () => {
  const expense = (over: Partial<CardExpense>) =>
    ({
      card_id: 'c1',
      amount: 3000,
      status: 'posted',
      installment_count: 1,
      spent_at: '2026-08-01',
      ...over,
    }) as Pick<CardExpense, 'card_id' | 'amount' | 'status' | 'installment_count' | 'spent_at'>

  it('averages 90-day single-shot spending and subtracts recurring', () => {
    const rows = [
      expense({ spent_at: '2026-08-01' }),
      expense({ spent_at: '2026-07-01' }),
      expense({ spent_at: '2026-06-05' }),
      expense({ spent_at: '2026-01-01' }), // pencere dışı
      expense({ status: 'provision' }), // kesinleşmemiş
      expense({ installment_count: 6 }), // taksitli
      expense({ card_id: 'c2' }), // başka kart
    ]
    // (3 × 3000) / 3 = 3000 aylık; 930 tekrar düşülür → 2070.
    expect(discretionaryMonthlyBase('c1', rows, 930, TODAY)).toBe(2070)
  })

  it('returns null with no usable rows and clamps at zero', () => {
    expect(discretionaryMonthlyBase('c1', [], 930, TODAY)).toBeNull()
    expect(discretionaryMonthlyBase('c1', [expense({ amount: 300 })], 930, TODAY)).toBe(0)
  })
})
