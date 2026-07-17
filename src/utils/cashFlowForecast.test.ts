import { describe, expect, it } from 'vitest'
import type {
  Asset,
  Card,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
} from '../types/database'
import { buildCashFlowForecast } from './cashFlowForecast'
import type { FinanceSummaryInput } from './financeSummary'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const FROM = new Date(2026, 5, 1) // 1 June 2026

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: 'TRY', symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...overrides }
}

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'banka_karti',
    holder_name: null, account_number: null,
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
    ...overrides,
  }
}

function loan(overrides: Partial<Loan>): Loan {
  return { ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0, monthly_payment: 0, installment_day: null, start_date: null, end_date: null, remaining_installments: 0, status: 'active', note: null, ...overrides }
}

function loanInstallment(overrides: Partial<LoanInstallment>): LoanInstallment {
  return { ...base, loan_id: 'L', installment_no: 1, due_date: '2026-06-01', amount: 0, status: 'bekliyor', paid_at: null, note: null, ...overrides }
}

function debt(overrides: Partial<Debt>): Debt {
  return { ...base, person_name: 'Kişi', direction: 'borç_aldım', value_type: 'TRY', currency: null, amount: 0, estimated_value_try: 0, auto_valued: false, due_date: null, status: 'açık', note: null, ...overrides }
}

function payment(overrides: Partial<Payment>): Payment {
  return { ...base, title: 'Ödeme', category: 'Fatura', amount: 0, amount_status: 'exact', due_date: '2026-06-01', status: 'bekliyor', payment_method: 'manual', recurrence: 'none', recurrence_day: null, recurrence_end_date: null, auto_source_card_id: null, note: null, ...overrides }
}

function salary(overrides: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 0, effective_date: '2026-01-01', note: null, ...overrides }
}

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return { ...base, card_id: 'c', card_expense_id: null, statement_archive_id: null, installment_no: 1, installment_count: 1, due_month: '2026-06-01', amount: 0, description: 'Taksit', category: 'Diğer', status: 'scheduled', posted_at: null, paid_at: null, note: null, ...overrides }
}

function statement(overrides: Partial<CardStatementArchive>): CardStatementArchive {
  return {
    ...base,
    card_id: 'cc',
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

function buildInput(overrides: Partial<FinanceSummaryInput> = {}): FinanceSummaryInput {
  return { assets: [], cards: [], loans: [], loanInstallments: [], debts: [], payments: [], salaryHistory: [], cardInstallments: [], ...overrides }
}

describe('buildCashFlowForecast', () => {
  it('defaults to a 6-month horizon with month keys and labels', () => {
    const { months } = buildCashFlowForecast(buildInput(), { from: FROM })
    expect(months).toHaveLength(6)
    expect(months.slice(0, 2).map((m) => m.monthKey)).toEqual(['2026-06-01', '2026-07-01'])
    expect(months[0].monthLabel).toContain('2026')
  })

  it('starts from liquid balance only: cash assets + bank card balances', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 10000 }), asset({ category: 'Altın', estimated_value_try: 50000 })],
        cards: [card({ card_type: 'banka_karti', current_balance: 5000 })],
      }),
      { from: FROM, horizonMonths: 1 },
    )
    expect(forecast.startingBalance).toBe(15000) // gold is excluded from liquid cash
  })

  it('treats salary as recurring income every month', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 1000 })],
        salaryHistory: [salary({ amount: 20000 })],
      }),
      { from: FROM, horizonMonths: 3 },
    )
    expect(forecast.months.map((m) => m.salary)).toEqual([20000, 20000, 20000])
    expect(forecast.months.map((m) => m.endingBalance)).toEqual([21000, 41000, 61000])
  })

  it('skips salary in month 0 when from is past the first business day', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 1000 })],
        salaryHistory: [salary({ amount: 20000 })],
      }),
      { from: new Date(2026, 5, 3), horizonMonths: 3 },
    )
    expect(forecast.months.map((m) => m.salary)).toEqual([0, 20000, 20000])
    expect(forecast.months.map((m) => m.endingBalance)).toEqual([1000, 21000, 41000])
  })

  it('starts future salary records in their effective month', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 1000 })],
        salaryHistory: [salary({ amount: 20000, effective_date: '2026-07-01' })],
      }),
      { from: FROM, horizonMonths: 3 },
    )

    expect(forecast.months.map((m) => m.salary)).toEqual([0, 20000, 20000])
    expect(forecast.months.map((m) => m.endingBalance)).toEqual([1000, 21000, 41000])
  })

  it('counts a statement once at its due month and the open period the cycle after', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        cards: [card({ card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 3000, current_period_spending: 1000 })],
      }),
      { from: FROM, horizonMonths: 3 },
    )
    expect(forecast.months.map((m) => m.cardOutflow)).toEqual([3000, 1000, 0])
  })

  it('uses open statement archives as the card outflow source when present', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        cards: [card({ id: 'cc', card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 5000, current_period_spending: 1000 })],
        cardStatements: [statement({ card_id: 'cc', statement_debt_amount: 3000, due_date: '2026-06-10' })],
      }),
      { from: FROM, horizonMonths: 2 },
    )

    expect(forecast.months.map((m) => m.cardOutflow)).toEqual([3000, 1000])
  })

  it('decrements a legacy loan over its remaining installments', () => {
    const forecast = buildCashFlowForecast(
      buildInput({ loans: [loan({ id: 'L', monthly_payment: 4000, installment_day: 5, remaining_installments: 2 })] }),
      { from: FROM, horizonMonths: 4 },
    )
    expect(forecast.months.map((m) => m.loanOutflow)).toEqual([4000, 4000, 0, 0])
  })

  it('uses scheduled installments instead of the legacy estimate when a loan has a plan', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        loans: [loan({ id: 'L', monthly_payment: 4000, installment_day: 5, remaining_installments: 12 })],
        loanInstallments: [loanInstallment({ loan_id: 'L', due_date: '2026-07-15', amount: 3500 })],
      }),
      { from: FROM, horizonMonths: 3 },
    )
    expect(forecast.months.map((m) => m.loanOutflow)).toEqual([0, 3500, 0])
  })

  it('does not subtract credit-card automatic payments from monthly cash outflow', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        payments: [
          payment({ due_date: '2026-06-10', amount: 1200, payment_method: 'bank_auto', auto_source_card_id: 'credit-card' }),
          payment({ due_date: '2026-06-12', amount: 300, payment_method: 'manual' }),
        ],
      }),
      { from: FROM, horizonMonths: 1 },
    )
    expect(forecast.months[0]).toMatchObject({ paymentOutflow: 300, outflow: 300 })
  })

  it('keeps scheduled card installments out of running cash until they become payable debt', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 1000 })],
        cards: [card({ id: 'cc', card_type: 'kredi_karti', due_day: 10 })],
        cardInstallments: [cardInstallment({ card_id: 'cc', due_month: '2026-06-01', amount: 400 })],
      }),
      { from: FROM, horizonMonths: 1 },
    )

    expect(forecast.months[0]).toMatchObject({ installmentOutflow: 0, outflow: 0, endingBalance: 1000 })
  })

  it('projects a full picture with running balance, lowest point, and no deficit', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 10000 })],
        cards: [
          card({ card_type: 'banka_karti', current_balance: 5000 }),
          card({ id: 'cc', card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 3000, current_period_spending: 1000 }),
        ],
        salaryHistory: [salary({ amount: 20000 })],
        payments: [
          payment({ recurrence: 'monthly', recurrence_day: 15, due_date: '2026-06-01', amount: 2000 }),
          payment({ recurrence: 'none', due_date: '2026-08-20', amount: 5000 }),
        ],
        loans: [loan({ id: 'L', monthly_payment: 4000, installment_day: 5, remaining_installments: 2 })],
        debts: [
          debt({ direction: 'borç_verdim', due_date: '2026-07-15', estimated_value_try: 8000 }),
          debt({ direction: 'borç_aldım', due_date: '2026-09-10', estimated_value_try: 6000 }),
        ],
        cardInstallments: [cardInstallment({ due_month: '2026-08-01', amount: 1500 })],
      }),
      { from: FROM, horizonMonths: 6 },
    )

    expect(forecast.startingBalance).toBe(15000)
    expect(forecast.months.map((m) => m.endingBalance)).toEqual([26000, 47000, 60000, 72000, 90000, 108000])
    expect(forecast.endingBalance).toBe(108000)
    expect(forecast.firstNegative).toBeNull()
    expect(forecast.lowest).toMatchObject({ monthKey: '2026-06-01', balance: 26000 })

    expect(forecast.months[1]).toMatchObject({ receivables: 8000, cardOutflow: 1000, income: 28000, outflow: 7000, net: 21000 })
    expect(forecast.months[2]).toMatchObject({ paymentOutflow: 7000, installmentOutflow: 0, outflow: 7000 })
    expect(forecast.months[3]).toMatchObject({ debtOutflow: 6000, outflow: 8000 })
  })

  it('flags the first negative month and the lowest balance in a deficit', () => {
    const forecast = buildCashFlowForecast(
      buildInput({
        assets: [asset({ category: 'Nakit', estimated_value_try: 1000 })],
        payments: [payment({ recurrence: 'none', due_date: '2026-07-20', amount: 5000 })],
      }),
      { from: FROM, horizonMonths: 3 },
    )
    expect(forecast.months.map((m) => m.endingBalance)).toEqual([1000, -4000, -4000])
    expect(forecast.firstNegative).toMatchObject({ monthKey: '2026-07-01', balance: -4000 })
    expect(forecast.lowest).toMatchObject({ monthKey: '2026-07-01', balance: -4000 })
  })
})
