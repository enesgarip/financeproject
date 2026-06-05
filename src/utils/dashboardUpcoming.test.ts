import { describe, expect, it } from 'vitest'
import type { Card, CardStatementArchive, Debt, Payment } from '../types/database'
import { buildDashboardUpcomingItems } from './dashboardUpcoming'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'kredi_karti',
    holder_name: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 10000,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: 1,
    due_day: 10,
    note: null,
    ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base,
    title: 'Fatura',
    category: 'Fatura',
    amount: 0,
    amount_status: 'exact',
    due_date: '2026-06-01',
    status: 'bekliyor',
    payment_method: 'manual',
    recurrence: 'none',
    recurrence_day: null,
    recurrence_end_date: null,
    note: null,
    ...overrides,
  }
}

function statement(overrides: Partial<CardStatementArchive>): CardStatementArchive {
  return {
    ...base,
    card_id: 'card',
    period_year: 2026,
    period_month: 6,
    statement_date: '2026-06-01',
    due_date: '2026-06-10',
    statement_debt_amount: 0,
    current_period_spending: 0,
    total_debt_amount: 0,
    status: 'open',
    paid_at: null,
    payment_source_card_id: null,
    note: null,
    ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base,
    person_name: 'Kisi',
    direction: 'borç_verdim',
    value_type: 'TRY',
    currency: null,
    amount: 1,
    estimated_value_try: 0,
    auto_valued: false,
    due_date: '2026-06-08',
    status: 'açık',
    note: null,
    ...overrides,
  }
}

describe('buildDashboardUpcomingItems', () => {
  it('uses obligations for dashboard outflows and keeps receivables out of the load list', () => {
    const items = buildDashboardUpcomingItems(
      {
        cards: [card({ id: 'card', statement_debt_amount: 2000 })],
        payments: [payment({ id: 'rent', title: 'Kira', amount: 5000, recurrence: 'monthly', recurrence_day: 5, due_date: '2026-01-05' })],
        loans: [],
        loanInstallments: [],
        debts: [debt({ id: 'receivable', estimated_value_try: 1000 })],
        cardInstallments: [],
        cardStatements: [statement({ id: 'statement', statement_debt_amount: 2000 })],
      },
      14,
      new Date(2026, 5, 1),
    )

    expect(items.map((item) => [item.kind, item.amount])).toEqual([
      ['payment', 5000],
      ['card', 2000],
    ])
  })
})
