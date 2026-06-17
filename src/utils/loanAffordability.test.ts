import { describe, expect, it } from 'vitest'
import type { Asset, Card, Debt, Loan, Payment, SalaryHistory } from '../types/database'
import { amortizedLoanPayment, buildLoanAffordability, loanPrincipalFromPayment } from './loanAffordability'
import type { FinanceSummaryInput } from './financeSummary'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const FROM = new Date(2026, 5, 1)

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'Nakit', category: 'Nakit', amount: 0, unit: 'TRY', currency: 'TRY', symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...overrides }
}

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
    ...overrides,
  }
}

function salary(overrides: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 0, effective_date: '2026-01-01', note: null, ...overrides }
}

function payment(overrides: Partial<Payment>): Payment {
  return { ...base, title: 'Ödeme', category: 'Fatura', amount: 0, amount_status: 'exact', due_date: '2026-06-01', status: 'bekliyor', payment_method: 'manual', recurrence: 'monthly', recurrence_day: 1, recurrence_end_date: null, auto_source_card_id: null, note: null, ...overrides }
}

function loan(overrides: Partial<Loan>): Loan {
  return { ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0, monthly_payment: 0, installment_day: 5, start_date: null, end_date: null, remaining_installments: 0, status: 'active', note: null, ...overrides }
}

function debt(overrides: Partial<Debt>): Debt {
  return { ...base, person_name: 'Kişi', direction: 'borç_aldım', value_type: 'TRY', currency: null, amount: 0, estimated_value_try: 0, auto_valued: false, due_date: '2026-07-10', status: 'açık', note: null, ...overrides }
}

function input(overrides: Partial<FinanceSummaryInput> = {}): FinanceSummaryInput {
  return {
    assets: [],
    cards: [],
    loans: [],
    loanInstallments: [],
    debts: [],
    payments: [],
    salaryHistory: [],
    cardInstallments: [],
    cardStatements: [],
    ...overrides,
  }
}

describe('loan annuity helpers', () => {
  it('round-trips payment and principal for a positive interest rate', () => {
    const payment = amortizedLoanPayment(100000, 3, 24)
    const principal = loanPrincipalFromPayment(payment, 3, 24)
    expect(payment).toBeGreaterThan(0)
    expect(principal).toBeCloseTo(100000, -1)
  })

  it('handles zero-interest loans as straight division', () => {
    expect(amortizedLoanPayment(120000, 0, 12)).toBe(10000)
    expect(loanPrincipalFromPayment(10000, 0, 12)).toBe(120000)
  })
})

describe('buildLoanAffordability', () => {
  it('allows a manageable requested loan when income and buffer are strong', () => {
    const result = buildLoanAffordability(
      input({
        assets: [asset({ estimated_value_try: 80000 })],
        cards: [card({ card_type: 'banka_karti', current_balance: 20000 })],
        salaryHistory: [salary({ amount: 60000 })],
        payments: [payment({ amount: 10000 })],
      }),
      { requestedPrincipal: 100000, monthlyInterestRatePct: 2.5, termMonths: 24, from: FROM },
    )

    expect(result.safeMonthlyPayment).toBeGreaterThan(result.requestedMonthlyPayment)
    expect(result.maxPrincipal).toBeGreaterThan(100000)
    expect(result.decision).toBe('suitable')
    expect(result.recommendation).not.toBeNull()

    if (!result.recommendation) throw new Error('Expected a balanced loan recommendation')
    expect(result.recommendation.monthlyPayment).toBeLessThanOrEqual(result.safeMonthlyPayment)
    expect(result.recommendation.principal).toBeGreaterThan(0)
    expect(result.recommendation.firstNegativeMonth).toBeNull()
    expect([6, 12, 18, 24, 36, 48, 60]).toContain(result.recommendation.termMonths)
  })

  it('rejects new debt when current load already consumes the safe band', () => {
    const result = buildLoanAffordability(
      input({
        salaryHistory: [salary({ amount: 40000 })],
        payments: [payment({ amount: 26000 })],
      }),
      { requestedPrincipal: 50000, monthlyInterestRatePct: 2, termMonths: 12, from: FROM },
    )

    expect(result.safeMonthlyPayment).toBe(0)
    expect(result.maxPrincipal).toBe(0)
    expect(result.recommendation).toBeNull()
    expect(result.decision).toBe('not_recommended')
  })

  it('uses near-term one-off stress when deciding whether the loan can pinch cash', () => {
    const result = buildLoanAffordability(
      input({
        assets: [asset({ estimated_value_try: 2000 })],
        salaryHistory: [salary({ amount: 50000 })],
        payments: [
          payment({ amount: 10000, recurrence: 'monthly', due_date: '2026-06-01', recurrence_day: 1 }),
          payment({ amount: 85000, recurrence: 'none', due_date: '2026-07-15', recurrence_day: null }),
        ],
      }),
      { requestedPrincipal: 100000, monthlyInterestRatePct: 3, termMonths: 12, from: FROM },
    )

    expect(result.assessedMonthlyLoad).toBeGreaterThan(result.averageMonthlyOutflow)
    expect(result.decision).toBe('not_recommended')
    expect(result.reasons.some((reason) => reason.includes('negatife'))).toBe(true)
  })

  it('includes existing legacy loan payments in assessed load', () => {
    const result = buildLoanAffordability(
      input({
        salaryHistory: [salary({ amount: 50000 })],
        loans: [loan({ monthly_payment: 8000, remaining_installments: 3 })],
      }),
      { requestedPrincipal: 100000, monthlyInterestRatePct: 2, termMonths: 24, from: FROM },
    )

    expect(result.assessedMonthlyLoad).toBe(8000)
    expect(result.safeMonthlyPayment).toBeGreaterThan(0)
  })

  it('requires stable salary income for a recommendation', () => {
    const result = buildLoanAffordability(
      input({
        debts: [debt({ direction: 'borç_verdim', estimated_value_try: 50000, due_date: '2026-06-10' })],
      }),
      { requestedPrincipal: 10000, monthlyInterestRatePct: 1, termMonths: 12, from: FROM },
    )

    expect(result.stableMonthlyIncome).toBe(0)
    expect(result.decision).toBe('not_recommended')
  })
})
