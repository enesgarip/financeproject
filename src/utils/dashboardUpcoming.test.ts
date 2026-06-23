import { describe, expect, it } from 'vitest'
import type { Card, CardInstallment, CardStatementArchive, Debt, Loan, LoanInstallment, Payment } from '../types/database'
import { buildDashboardMonthlyLoad, buildDashboardUpcomingItems } from './dashboardUpcoming'

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
    last_four_digits: null,
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
    auto_source_card_id: null,
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
    reconciled_bank_amount: null,
    reconciled_at: null,
    reconciliation_note: null,
    note: null,
    ...overrides,
  }
}

function loan(overrides: Partial<Loan>): Loan {
  return {
    ...base,
    bank_name: 'Banka',
    loan_name: 'Kredi',
    total_amount: 0,
    remaining_amount: 0,
    monthly_payment: 0,
    installment_day: null,
    start_date: null,
    end_date: null,
    remaining_installments: 0,
    status: 'active',
    note: null,
    ...overrides,
  }
}

function loanInstallment(overrides: Partial<LoanInstallment>): LoanInstallment {
  return {
    ...base,
    loan_id: 'planned-loan',
    installment_no: 1,
    due_date: '2026-06-01',
    amount: 0,
    status: 'bekliyor',
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return {
    ...base,
    card_id: 'card',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 3,
    due_month: '2026-06-01',
    amount: 0,
    description: 'Taksit',
    category: 'Diğer',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
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

  it('keeps card automatic payments visible without cash impact', () => {
    const items = buildDashboardUpcomingItems(
      {
        cards: [card({ id: 'credit-card', bank_name: 'Banka', card_name: 'Kart' })],
        payments: [
          payment({
            id: 'icloud',
            title: 'iCloud+',
            amount: 130,
            due_date: '2026-06-11',
            payment_method: 'bank_auto',
            auto_source_card_id: 'credit-card',
          }),
        ],
        loans: [],
        loanInstallments: [],
        debts: [],
        cardInstallments: [],
        cardStatements: [],
      },
      14,
      new Date(2026, 5, 1),
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'iCloud+',
      amount: 130,
      cashImpactAmount: 0,
      settlement: 'credit_card',
      kind: 'payment',
    })
  })
})

describe('buildDashboardMonthlyLoad', () => {
  it('summarizes the dashboard load from normalized obligations', () => {
    const load = buildDashboardMonthlyLoad(
      {
        cards: [card({ id: 'card', statement_debt_amount: 400 })],
        payments: [
          payment({ id: 'rent', title: 'Kira', amount: 100, due_date: '2026-06-05' }),
          payment({ id: 'auto', title: 'Kart talimatı', amount: 50, due_date: '2026-06-06', payment_method: 'bank_auto', auto_source_card_id: 'card' }),
        ],
        loans: [loan({ id: 'legacy-loan', monthly_payment: 300, installment_day: 7, remaining_installments: 1 })],
        loanInstallments: [loanInstallment({ loan_id: 'planned-loan', amount: 200, due_date: '2026-06-08' })],
        debts: [debt({ id: 'debt', direction: 'borç_aldım', estimated_value_try: 80, due_date: '2026-06-09' })],
        cardInstallments: [cardInstallment({ amount: 70, due_month: '2026-06-01' })],
        cardStatements: [statement({ id: 'statement', card_id: 'card', statement_debt_amount: 400, due_date: '2026-06-10' })],
      },
      new Date(2026, 5, 1),
      new Date(2026, 5, 1),
    )

    expect(load).toMatchObject({
      payments: 150,
      cardStatements: 400,
      cardInstallments: 70,
      loanInstallments: 200,
      legacyLoanInstallments: 300,
      personalDebts: 80,
      total: 1200,
    })
  })
})
