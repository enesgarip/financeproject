import { describe, expect, it } from 'vitest'
import {
  applyScenario,
  loanPayoffAmount,
  payoffBreakEvenMonthKey,
  scenarioStartingCashDelta,
} from './scenarioForecast'
import type { FinanceSummaryInput } from './financeSummary'
import type { Loan, LoanInstallment, Payment } from '../types/database'

const baseRow = {
  user_id: 'u1',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

const loan1: Loan = {
  ...baseRow,
  id: 'loan-1',
  bank_name: 'Banka A',
  loan_name: 'Konut',
  total_amount: 500_000,
  remaining_amount: 400_000,
  monthly_payment: 2_000,
  installment_day: 5,
  start_date: null,
  end_date: null,
  remaining_installments: 200,
  status: 'active',
  note: null,
}

const loan2: Loan = {
  ...baseRow,
  id: 'loan-2',
  bank_name: 'Banka B',
  loan_name: 'Araç',
  total_amount: 100_000,
  remaining_amount: 60_000,
  monthly_payment: 1_000,
  installment_day: 10,
  start_date: null,
  end_date: null,
  remaining_installments: 60,
  status: 'active',
  note: null,
}

const installment1: LoanInstallment = {
  ...baseRow,
  id: 'inst-1',
  loan_id: 'loan-1',
  installment_no: 1,
  due_date: '2026-07-05',
  amount: 2_000,
  status: 'bekliyor',
  paid_at: null,
  note: null,
}

const installment2: LoanInstallment = {
  ...baseRow,
  id: 'inst-2',
  loan_id: 'loan-2',
  installment_no: 1,
  due_date: '2026-07-10',
  amount: 1_000,
  status: 'bekliyor',
  paid_at: null,
  note: null,
}

const payment1: Payment = {
  ...baseRow,
  id: 'pay-1',
  title: 'Netflix',
  category: 'Dijital üyelik',
  amount: 200,
  amount_status: 'exact',
  due_date: '2026-07-01',
  status: 'bekliyor',
  payment_method: 'manual',
  recurrence: 'monthly',
  recurrence_day: 1,
  recurrence_end_date: null,
  auto_source_card_id: null,
  note: null,
}

const minimalData: FinanceSummaryInput = {
  assets: [],
  cards: [],
  loans: [loan1, loan2],
  loanInstallments: [installment1, installment2],
  debts: [],
  payments: [payment1],
  salaryHistory: [],
  cardInstallments: [],
}

describe('applyScenario', () => {
  it('returns same data when mutations empty', () => {
    const result = applyScenario(minimalData, [])
    expect(result).toBe(minimalData) // same reference — no copy
  })

  it('removes a loan and its installments', () => {
    const result = applyScenario(minimalData, [{ type: 'remove_loan', loanId: 'loan-1' }])
    expect(result.loans).toHaveLength(1)
    expect(result.loans[0]!.id).toBe('loan-2')
    expect(result.loanInstallments).toHaveLength(1)
    expect(result.loanInstallments[0]!.loan_id).toBe('loan-2')
  })

  it('removes multiple loans at once', () => {
    const result = applyScenario(minimalData, [
      { type: 'remove_loan', loanId: 'loan-1' },
      { type: 'remove_loan', loanId: 'loan-2' },
    ])
    expect(result.loans).toHaveLength(0)
    expect(result.loanInstallments).toHaveLength(0)
  })

  it('removes a payment', () => {
    const result = applyScenario(minimalData, [{ type: 'remove_payment', paymentId: 'pay-1' }])
    expect(result.payments).toHaveLength(0)
  })

  it('removes loan and payment in same call', () => {
    const result = applyScenario(minimalData, [
      { type: 'remove_loan', loanId: 'loan-1' },
      { type: 'remove_payment', paymentId: 'pay-1' },
    ])
    expect(result.loans).toHaveLength(1)
    expect(result.payments).toHaveLength(0)
  })

  it('leaves unrelated data untouched', () => {
    const result = applyScenario(minimalData, [{ type: 'remove_loan', loanId: 'loan-1' }])
    expect(result.payments).toBe(minimalData.payments)
    expect(result.assets).toBe(minimalData.assets)
  })

  it('ignores unknown ids gracefully', () => {
    const result = applyScenario(minimalData, [{ type: 'remove_loan', loanId: 'nonexistent' }])
    expect(result.loans).toHaveLength(2)
    expect(result.loanInstallments).toHaveLength(2)
  })

  it('payoff_loan_today strips the loan and its installments like remove_loan', () => {
    const result = applyScenario(minimalData, [{ type: 'payoff_loan_today', loanId: 'loan-1' }])
    expect(result.loans.map((l) => l.id)).toEqual(['loan-2'])
    expect(result.loanInstallments.map((i) => i.loan_id)).toEqual(['loan-2'])
  })

  it('cash_shock leaves all rows untouched', () => {
    const result = applyScenario(minimalData, [{ type: 'cash_shock', amount: 50_000 }])
    expect(result.loans).toBe(minimalData.loans)
    expect(result.loanInstallments).toBe(minimalData.loanInstallments)
    expect(result.payments).toBe(minimalData.payments)
  })
})

// Payoff/şok senaryolarının nakit tarafı: planlı kredi + legacy kredi + kapalı plan.
const paidInstallment: LoanInstallment = {
  ...baseRow,
  id: 'inst-1-paid',
  loan_id: 'loan-1',
  installment_no: 2,
  due_date: '2026-06-05',
  amount: 2_000,
  status: 'ödendi',
  paid_at: '2026-06-05',
  note: null,
}

const legacyLoan: Loan = {
  ...baseRow,
  id: 'loan-legacy',
  bank_name: 'Banka C',
  loan_name: 'İhtiyaç',
  total_amount: 30_000,
  remaining_amount: 15_000,
  monthly_payment: 1_500,
  installment_day: 7,
  start_date: null,
  end_date: null,
  remaining_installments: 10,
  status: 'active',
  note: null,
}

const paidOffLoan: Loan = {
  ...baseRow,
  id: 'loan-paid',
  bank_name: 'Banka D',
  loan_name: 'Bitmiş',
  total_amount: 10_000,
  remaining_amount: 0,
  monthly_payment: 1_000,
  installment_day: 3,
  start_date: null,
  end_date: null,
  remaining_installments: 0,
  status: 'active',
  note: null,
}

const paidOffInstallment: LoanInstallment = {
  ...baseRow,
  id: 'inst-paid-off',
  loan_id: 'loan-paid',
  installment_no: 1,
  due_date: '2026-05-03',
  amount: 1_000,
  status: 'ödendi',
  paid_at: '2026-05-03',
  note: null,
}

const payoffData: FinanceSummaryInput = {
  ...minimalData,
  loans: [loan1, loan2, legacyLoan, paidOffLoan],
  loanInstallments: [installment1, installment2, paidInstallment, paidOffInstallment],
}

describe('loanPayoffAmount', () => {
  it('sums only pending installments for a planned loan', () => {
    // loan-1'in ödenmiş 2. taksiti toplama girmez.
    expect(loanPayoffAmount(payoffData, 'loan-1')).toBe(2_000)
  })

  it('falls back to monthly_payment × remaining_installments for a legacy loan', () => {
    expect(loanPayoffAmount(payoffData, 'loan-legacy')).toBe(15_000)
  })

  it('returns 0 for a fully paid planned loan and for unknown ids', () => {
    expect(loanPayoffAmount(payoffData, 'loan-paid')).toBe(0)
    expect(loanPayoffAmount(payoffData, 'nonexistent')).toBe(0)
  })
})

describe('scenarioStartingCashDelta', () => {
  it('returns 0 (not -0) when nothing costs cash today', () => {
    expect(scenarioStartingCashDelta(payoffData, [])).toBe(0)
    expect(scenarioStartingCashDelta(payoffData, [{ type: 'remove_payment', paymentId: 'pay-1' }])).toBe(0)
  })

  it('accumulates payoff and shock as a negative delta', () => {
    const delta = scenarioStartingCashDelta(payoffData, [
      { type: 'payoff_loan_today', loanId: 'loan-1' },
      { type: 'payoff_loan_today', loanId: 'loan-legacy' },
      { type: 'cash_shock', amount: 5_000 },
    ])
    expect(delta).toBe(-22_000)
  })
})

describe('payoffBreakEvenMonthKey', () => {
  it('uses the month of the latest pending installment for a planned loan', () => {
    expect(payoffBreakEvenMonthKey(payoffData, 'loan-1', new Date(2026, 5, 15))).toBe('2026-07-01')
  })

  it('projects from-month + remaining − 1 for a legacy loan', () => {
    expect(payoffBreakEvenMonthKey(payoffData, 'loan-legacy', new Date(2026, 5, 15))).toBe('2027-03-01')
  })

  it('returns null for a fully paid plan and unknown ids', () => {
    expect(payoffBreakEvenMonthKey(payoffData, 'loan-paid', new Date(2026, 5, 15))).toBeNull()
    expect(payoffBreakEvenMonthKey(payoffData, 'nonexistent', new Date(2026, 5, 15))).toBeNull()
  })
})
