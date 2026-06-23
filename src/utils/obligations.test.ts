import { describe, expect, it } from 'vitest'
import type { Card, CardInstallment, CardStatementArchive, Debt, Loan, LoanInstallment, Payment } from '../types/database'
import {
  buildFinanceObligationsForMonth,
  buildFinanceObligationsForRange,
  summarizeFinanceObligations,
  type FinanceObligationsInput,
} from './obligations'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const FROM = new Date(2026, 5, 1)

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'banka_karti',
    holder_name: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 0,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: null,
    due_day: null,
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
    loan_id: 'loan',
    installment_no: 1,
    due_date: '2026-06-01',
    amount: 0,
    status: 'bekliyor',
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base,
    person_name: 'Kisi',
    direction: 'borç_aldım',
    value_type: 'TRY',
    currency: null,
    amount: 1,
    estimated_value_try: 0,
    auto_valued: false,
    due_date: null,
    status: 'açık',
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

function input(overrides: Partial<FinanceObligationsInput> = {}): FinanceObligationsInput {
  return {
    cards: [],
    payments: [],
    loans: [],
    loanInstallments: [],
    debts: [],
    cardInstallments: [],
    cardStatements: [],
    ...overrides,
  }
}

describe('buildFinanceObligationsForMonth', () => {
  it('combines planned outflows and receivables into a monthly summary', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        payments: [payment({ amount: 1000, due_date: '2026-06-15' })],
        loans: [loan({ id: 'loan', loan_name: 'Konut' })],
        loanInstallments: [loanInstallment({ loan_id: 'loan', amount: 3000, due_date: '2026-06-05' })],
        debts: [
          debt({ direction: 'borç_aldım', estimated_value_try: 750, due_date: '2026-06-20' }),
          debt({ id: 'receivable', direction: 'borç_verdim', estimated_value_try: 500, due_date: '2026-06-25' }),
        ],
      }),
      FROM,
      { from: FROM },
    )

    expect(items.map((item) => item.kind)).toEqual(['loan_installment', 'payment', 'personal_debt', 'personal_receivable'])
    expect(summarizeFinanceObligations(items)).toMatchObject({ outflow: 4750, inflow: 500, net: -4250, payableCount: 4 })
  })

  it('uses open statement archives instead of duplicating card statement debt', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'card', card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 3000 })],
        cardStatements: [statement({ id: 'statement', card_id: 'card', statement_debt_amount: 3000 })],
      }),
      FROM,
      { from: FROM },
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'card_statement', action: 'pay_card_statement', amount: 3000 })
  })

  it('marks credit-card automatic payments as non-cash obligations', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'credit-card', card_type: 'kredi_karti', bank_name: 'Banka', card_name: 'Kart' })],
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
      }),
      FROM,
      { from: FROM },
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'payment',
      amount: 130,
      cashImpactAmount: 0,
      settlement: 'credit_card',
      relatedCardId: 'credit-card',
    })
  })

  it('summarizes monthly totals from cash impact, not raw card-settled load', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'credit-card', card_type: 'kredi_karti', due_day: 20 })],
        payments: [
          payment({ id: 'cash-payment', amount: 500, due_date: '2026-06-10' }),
          payment({
            id: 'card-payment',
            amount: 200,
            due_date: '2026-06-10',
            payment_method: 'bank_auto',
            auto_source_card_id: 'credit-card',
          }),
        ],
        cardInstallments: [
          cardInstallment({ id: 'future-card-load', card_id: 'credit-card', due_month: '2026-06-01', amount: 300 }),
        ],
      }),
      FROM,
      { from: FROM },
    )

    expect(summarizeFinanceObligations(items)).toMatchObject({
      outflow: 500,
      inflow: 0,
      net: -500,
      payableCount: 2,
      itemCount: 3,
    })
  })

  it('places card installments and legacy loan estimates on their calendar days', () => {
    const july = new Date(2026, 6, 1)
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'card', card_type: 'kredi_karti', due_day: 12 })],
        cardInstallments: [cardInstallment({ id: 'installment', card_id: 'card', due_month: '2026-07-01', amount: 400 })],
        loans: [loan({ id: 'legacy', monthly_payment: 2000, installment_day: 7, remaining_installments: 2 })],
      }),
      july,
      { from: FROM },
    )

    expect(items.map((item) => [item.kind, item.date, item.amount, item.action])).toEqual([
      ['legacy_loan_installment', '2026-07-07', 2000, null],
      ['card_installment', '2026-07-12', 400, null],
    ])
    expect(items.find((item) => item.kind === 'card_installment')).toMatchObject({ cashImpactAmount: 0, settlement: 'credit_card' })
  })

  it('builds a short range from the same obligation source of truth', () => {
    const items = buildFinanceObligationsForRange(
      input({
        payments: [
          payment({
            id: 'rent',
            title: 'Kira',
            amount: 5000,
            due_date: '2026-01-05',
            recurrence: 'monthly',
            recurrence_day: 5,
          }),
        ],
        cards: [card({ id: 'card', card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 3000 })],
        cardStatements: [statement({ id: 'statement', card_id: 'card', statement_debt_amount: 3000, due_date: '2026-06-10' })],
      }),
      { from: new Date(2026, 5, 1), days: 14 },
    )

    expect(items.map((item) => [item.kind, item.date, item.amount])).toEqual([
      ['payment', '2026-06-05', 5000],
      ['card_statement', '2026-06-10', 3000],
    ])
  })

  it('does not include obligations outside the requested range', () => {
    const items = buildFinanceObligationsForRange(
      input({
        payments: [
          payment({ id: 'inside', amount: 100, due_date: '2026-06-03' }),
          payment({ id: 'outside', amount: 200, due_date: '2026-07-03' }),
        ],
      }),
      { from: new Date(2026, 5, 1), days: 10 },
    )

    expect(items.map((item) => item.sourceId)).toEqual(['inside'])
  })
})
