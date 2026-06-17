import { describe, expect, it } from 'vitest'
import type { Card, CardInstallment } from '../types/database'
import { buildCardInstallmentCalendar, totalScheduledInstallments } from './cardInstallmentCalendar'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    ...base,
    bank_name: 'Test Bank',
    card_name: 'Test Card',
    card_type: 'kredi_karti',
    credit_limit: 10000,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    current_balance: 0,
    statement_day: 1,
    due_day: 10,
    color: null,
    limit_group_name: null,
    ...overrides,
  } as Card
}

function makeInstallment(overrides: Partial<CardInstallment> = {}): CardInstallment {
  return {
    ...base,
    card_id: 'card-1',
    card_expense_id: 'expense-1',
    description: 'Test Taksit',
    category: 'Genel',
    installment_no: 1,
    installment_count: 3,
    amount: 100,
    due_month: '2026-06-01',
    status: 'scheduled',
    posted_at: null,
    ...overrides,
  } as CardInstallment
}

describe('buildCardInstallmentCalendar', () => {
  it('returns empty rows for months with no installments', () => {
    const result = buildCardInstallmentCalendar([], [], 3)
    expect(result).toHaveLength(3)
    expect(result.every((month) => month.rows.length === 0 && month.total === 0)).toBe(true)
  })

  it('groups installments by card within a month', () => {
    const cards = [
      makeCard({ id: 'card-1' }),
      makeCard({ id: 'card-2', bank_name: 'Diğer Bank' }),
    ]

    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const installments = [
      makeInstallment({ id: 'i1', card_id: 'card-1', amount: 100, due_month: currentMonth }),
      makeInstallment({ id: 'i2', card_id: 'card-1', amount: 200, due_month: currentMonth }),
      makeInstallment({ id: 'i3', card_id: 'card-2', amount: 150, due_month: currentMonth }),
    ]

    const result = buildCardInstallmentCalendar(installments, cards, 2)
    const firstMonth = result[0]

    expect(firstMonth.rows).toHaveLength(2)
    expect(firstMonth.total).toBe(450)

    const card1Row = firstMonth.rows.find((r) => r.cardId === 'card-1')!
    expect(card1Row.amount).toBe(300)
    expect(card1Row.count).toBe(2)

    const card2Row = firstMonth.rows.find((r) => r.cardId === 'card-2')!
    expect(card2Row.amount).toBe(150)
    expect(card2Row.count).toBe(1)
  })

  it('excludes paid installments', () => {
    const cards = [makeCard({ id: 'card-1' })]
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const installments = [
      makeInstallment({ id: 'i1', card_id: 'card-1', amount: 100, due_month: currentMonth, status: 'paid' }),
      makeInstallment({ id: 'i2', card_id: 'card-1', amount: 200, due_month: currentMonth, status: 'scheduled' }),
    ]

    const result = buildCardInstallmentCalendar(installments, cards, 1)
    expect(result[0].total).toBe(200)
    expect(result[0].rows[0].count).toBe(1)
  })

  it('sorts rows by amount descending', () => {
    const cards = [
      makeCard({ id: 'card-1' }),
      makeCard({ id: 'card-2', bank_name: 'Büyük Bank' }),
    ]
    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const installments = [
      makeInstallment({ id: 'i1', card_id: 'card-1', amount: 50, due_month: currentMonth }),
      makeInstallment({ id: 'i2', card_id: 'card-2', amount: 500, due_month: currentMonth }),
    ]

    const result = buildCardInstallmentCalendar(installments, cards, 1)
    expect(result[0].rows[0].cardId).toBe('card-2')
    expect(result[0].rows[1].cardId).toBe('card-1')
  })
})

describe('totalScheduledInstallments', () => {
  it('sums only scheduled installments', () => {
    const installments = [
      makeInstallment({ id: 'i1', amount: 100, status: 'scheduled' }),
      makeInstallment({ id: 'i2', amount: 200, status: 'paid' }),
      makeInstallment({ id: 'i3', amount: 300, status: 'scheduled' }),
      makeInstallment({ id: 'i4', amount: 150, status: 'posted' }),
    ]

    expect(totalScheduledInstallments(installments)).toBe(400)
  })

  it('returns 0 for empty array', () => {
    expect(totalScheduledInstallments([])).toBe(0)
  })
})
