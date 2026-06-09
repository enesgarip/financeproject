import { describe, expect, it } from 'vitest'
import { applyScenario } from './scenarioForecast'
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
})
