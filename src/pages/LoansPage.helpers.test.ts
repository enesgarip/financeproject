import { describe, expect, it } from 'vitest'
import type { InsertFor, LoanInstallment } from '../types/database'
import { mergeLoanInstallmentSchedule } from './LoansPage.helpers'

function installment(overrides: Partial<LoanInstallment> = {}): LoanInstallment {
  return {
    id: 'installment-1',
    user_id: 'user-1',
    loan_id: 'loan-1',
    installment_no: 1,
    due_date: '2026-01-10',
    amount: 1_000,
    status: 'ödendi',
    paid_at: '2026-01-09T12:00:00Z',
    note: 'Ödendi',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-09T12:00:00Z',
    ...overrides,
  }
}

function desired(overrides: Partial<InsertFor<'loan_installments'>> = {}): InsertFor<'loan_installments'> {
  return {
    id: 'new-1',
    user_id: 'user-1',
    loan_id: 'loan-1',
    installment_no: 1,
    due_date: '2026-02-20',
    amount: 2_000,
    status: 'bekliyor',
    paid_at: null,
    note: null,
    ...overrides,
  }
}

describe('mergeLoanInstallmentSchedule', () => {
  it('preserves paid installment amount, due date and payment metadata', () => {
    const { payload } = mergeLoanInstallmentSchedule([installment()], [desired()])
    expect(payload[0]).toMatchObject({
      id: 'installment-1',
      due_date: '2026-01-10',
      amount: 1_000,
      status: 'ödendi',
      paid_at: '2026-01-09T12:00:00Z',
      note: 'Ödendi',
    })
  })

  it('never deletes paid installments outside the edited plan', () => {
    const paidExtra = installment({ installment_no: 3, id: 'paid-extra' })
    const pendingExtra = installment({ installment_no: 4, id: 'pending-extra', status: 'bekliyor', paid_at: null })
    const { extraIds } = mergeLoanInstallmentSchedule([paidExtra, pendingExtra], [desired()])
    expect(extraIds).toEqual(['pending-extra'])
  })
})
