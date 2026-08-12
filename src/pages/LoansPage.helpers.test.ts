import { describe, expect, it } from 'vitest'
import type { InsertFor, LoanInstallment } from '../types/database'
import {
  PAID_BEFORE_APP_NOTE,
  markPaidWithoutCashPayload,
  mergeLoanInstallmentSchedule,
  pastDuePendingInstallments,
} from './LoansPage.helpers'

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

describe('markPaidWithoutCashPayload / pastDuePendingInstallments (BM-5c)', () => {
  it('selects only pending installments with a past due date', () => {
    const rows = [
      installment({ id: 'p1', installment_no: 1, due_date: '2026-01-10', status: 'ödendi' }),
      installment({ id: 'p2', installment_no: 2, due_date: '2026-02-10', status: 'bekliyor', paid_at: null }),
      installment({ id: 'p3', installment_no: 3, due_date: '2026-09-10', status: 'bekliyor', paid_at: null }),
    ]
    const past = pastDuePendingInstallments(rows, '2026-08-10')
    expect(past.map((r) => r.id)).toEqual(['p2'])
  })

  it('marks rows paid at their own due date without touching amount/date and stamps the no-cash note', () => {
    const row = installment({ id: 'p2', installment_no: 2, due_date: '2026-02-10', status: 'bekliyor', paid_at: null, note: null })
    const [payload] = markPaidWithoutCashPayload([row])
    expect(payload).toMatchObject({
      id: 'p2',
      installment_no: 2,
      due_date: '2026-02-10',
      amount: 1_000,
      status: 'ödendi',
      note: PAID_BEFORE_APP_NOTE,
    })
    // Sabit +03:00 yerine cihaz ofseti: değer HER ZAMAN vade gününün yerel
    // gece yarısını gösterir (Türkiye'de eski çıktıyla birebir aynı).
    expect(payload.paid_at).toMatch(/^2026-02-10T00:00:00[+-]\d{2}:\d{2}$/)
    expect(new Date(payload.paid_at!).getTime()).toBe(new Date(2026, 1, 10).getTime())
  })

  it('keeps an existing user note instead of overwriting it', () => {
    const row = installment({ id: 'p2', status: 'bekliyor', paid_at: null, note: 'elden ödendi' })
    const [payload] = markPaidWithoutCashPayload([row])
    expect(payload.note).toBe('elden ödendi')
  })
})
