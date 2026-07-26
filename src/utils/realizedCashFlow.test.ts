import { describe, expect, it } from 'vitest'
import type { Payment, TransactionHistory } from '../types/database'
import { buildRealizedMonthlyOutflow } from './realizedCashFlow'

const base = { user_id: 'u', created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z' }

function row(overrides: Partial<TransactionHistory>): TransactionHistory {
  return {
    ...base,
    id: overrides.id ?? Math.random().toString(36).slice(2),
    occurred_at: '2026-07-10T10:00:00Z',
    type: 'payment',
    title: 'Ödeme',
    amount: 100,
    source_table: 'payments',
    source_id: 'p1',
    note: null,
    ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base,
    id: 'p1',
    title: 'Fatura',
    category: 'Fatura',
    amount: 100,
    amount_status: 'exact',
    due_date: '2026-07-10',
    status: 'ödendi',
    payment_method: 'bank_auto',
    recurrence: 'monthly',
    recurrence_day: 10,
    recurrence_end_date: null,
    auto_source_card_id: null,
    note: null,
    ...overrides,
  } as Payment
}

const JULY = new Date(2026, 6, 15)

describe('buildRealizedMonthlyOutflow', () => {
  it('kaynak tablosuna göre kart/fatura/kredi/borç kovalarına ayırır', () => {
    const result = buildRealizedMonthlyOutflow(
      [
        row({ source_table: 'card_statement_archives', source_id: 's1', amount: 80309.91, title: 'Black ekstresi ödendi' }),
        row({ source_table: 'payments', source_id: 'p1', amount: 685 }),
        row({ type: 'loan', source_table: 'loan_installments', source_id: 'l1', amount: 3000, title: 'Kredi taksiti ödendi' }),
        row({ type: 'debt', source_table: 'debts', source_id: 'd1', amount: 500, title: 'Borç kapandı', note: 'Banka hesabından ödendi.' }),
      ],
      [payment({ id: 'p1' })],
      JULY,
    )
    expect(result.cardPayments).toBe(80309.91)
    expect(result.billPayments).toBe(685)
    expect(result.loanPayments).toBe(3000)
    expect(result.debtPayments).toBe(500)
    expect(result.totalCash).toBe(84494.91)
  })

  it('kart talimatlı planlı ödeme nakit sayılmaz, ayrı kovaya gider', () => {
    const result = buildRealizedMonthlyOutflow(
      [row({ source_table: 'payments', source_id: 'p1', amount: 685 })],
      [payment({ id: 'p1', payment_method: 'bank_auto', auto_source_card_id: 'c1' })],
      JULY,
    )
    expect(result.billPayments).toBe(0)
    expect(result.cardFundedBills).toBe(685)
    expect(result.totalCash).toBe(0)
  })

  it('geri alınan ödeme orijinal tutarı netleştirir', () => {
    const result = buildRealizedMonthlyOutflow(
      [
        row({ source_table: 'payments', source_id: 'p1', amount: 685, occurred_at: '2026-07-10T10:00:00Z' }),
        row({ source_table: 'payments', source_id: 'p1', amount: 685, occurred_at: '2026-07-11T10:00:00Z', title: 'Fatura ödemesi geri alındı' }),
      ],
      [payment({ id: 'p1' })],
      JULY,
    )
    expect(result.billPayments).toBe(0)
    expect(result.totalCash).toBe(0)
  })

  it('ay dışını ve alacak tahsilatını saymaz', () => {
    const result = buildRealizedMonthlyOutflow(
      [
        row({ source_table: 'payments', source_id: 'p1', amount: 685, occurred_at: '2026-06-10T10:00:00Z' }),
        row({ type: 'debt', source_table: 'debts', source_id: 'd1', amount: 23000, title: 'Alacak kapandı', note: 'Banka hesabına tahsil edildi.' }),
      ],
      [payment({ id: 'p1' })],
      JULY,
    )
    expect(result.totalCash).toBe(0)
  })

  it('silinmiş ödeme kaydında temkinli davranıp nakit sayar', () => {
    const result = buildRealizedMonthlyOutflow(
      [row({ source_table: 'payments', source_id: 'gone', amount: 400 })],
      [],
      JULY,
    )
    expect(result.billPayments).toBe(400)
  })
})
