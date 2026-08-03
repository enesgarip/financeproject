import { describe, expect, it } from 'vitest'
import { resolveStatementImportAction, type StatementImportActionInput } from './statementImportPlan'

function tx(overrides: Partial<StatementImportActionInput> = {}): StatementImportActionInput {
  return {
    date: '2026-05-19',
    amount: 1_000,
    isInstallment: false,
    installmentNo: 1,
    installmentCount: 1,
    ...overrides,
  }
}

describe('resolveStatementImportAction', () => {
  it('tek çekim → expense (tutar/tarih aynen, adet 1)', () => {
    expect(resolveStatementImportAction({ transaction: tx({ amount: 250, date: '2026-05-10' }) })).toEqual({
      kind: 'expense',
      amount: 250,
      spentAt: '2026-05-10',
      installmentCount: 1,
    })
  })

  it('1. taksit → expense: tam planı sıfırdan kurar (toplam tutar + adet, orijinal tarih)', () => {
    expect(
      resolveStatementImportAction({
        transaction: tx({ isInstallment: true, installmentNo: 1, installmentCount: 12, amount: 1_000, date: '2026-05-19' }),
      }),
    ).toEqual({
      kind: 'expense',
      amount: 12_000,
      spentAt: '2026-05-19',
      installmentCount: 12,
    })
  })

  it('plan-ortası taksit → carryover: geçmiş taksitler ödenmiş sayılır, kalan kurulur', () => {
    expect(
      resolveStatementImportAction({
        transaction: tx({ isInstallment: true, installmentNo: 4, installmentCount: 12, amount: 1_000, date: '2026-05-19' }),
      }),
    ).toEqual({
      kind: 'carryover',
      installmentAmount: 1_000,
      totalInstallments: 12,
      paidInstallments: 3,
      // orijinal tarih + 3 ay = bu (4.) taksitin vadesi
      nextDueDate: '2026-08-19',
    })
  })

  it('son taksit → carryover: (adet-1) ödenmiş, 1 kalan', () => {
    const action = resolveStatementImportAction({
      transaction: tx({ isInstallment: true, installmentNo: 12, installmentCount: 12, amount: 250, date: '2025-08-31' }),
    })
    expect(action.kind).toBe('carryover')
    if (action.kind === 'carryover') {
      expect(action.paidInstallments).toBe(11)
      expect(action.totalInstallments).toBe(12)
      expect(action.nextDueDate).toBe('2026-07-31')
    }
  })

  it('planlı ödeme her şeyin önünde (taksit satırı olsa bile)', () => {
    expect(
      resolveStatementImportAction({
        transaction: tx({ isInstallment: true, installmentNo: 3, installmentCount: 9, amount: 500, date: '2026-05-19' }),
        plannedPaymentId: 'pay-1',
      }),
    ).toEqual({ kind: 'payment', paymentId: 'pay-1', amount: 500, spentAt: '2026-05-19' })
  })

  it('toplam adet bilinmiyorsa (count 0) taksit değil, tek harcama gibi işlenir', () => {
    // Ekstrede toplam adet yoksa buildImportedInstallmentPlan çağrılmaz; satır
    // olduğu gibi (aylık tutar) tek harcama olur. (Bu satır aslında modalda
    // "manuel kontrol"e düşer; plancı yine de güvenli davranmalı.)
    expect(
      resolveStatementImportAction({
        transaction: tx({ isInstallment: true, installmentNo: 3, installmentCount: 0, amount: 500 }),
      }),
    ).toMatchObject({ kind: 'expense', amount: 500, installmentCount: 1 })
  })

  it('manuel akış: kullanıcı toplam adedi girince taksit planı kurulur (override)', () => {
    // Ekstrede count belirsizdi (0); kullanıcı 6 girdi, no=1 → 1. taksit planı.
    expect(
      resolveStatementImportAction({
        transaction: tx({ isInstallment: true, installmentNo: 1, installmentCount: 0, amount: 500, date: '2026-05-19' }),
        totalInstallmentsOverride: 6,
      }),
    ).toEqual({ kind: 'expense', amount: 3_000, spentAt: '2026-05-19', installmentCount: 6 })
  })

  it('manuel akış: override ile plan-ortası da carryover olur', () => {
    const action = resolveStatementImportAction({
      transaction: tx({ isInstallment: true, installmentNo: 3, installmentCount: 0, amount: 500, date: '2026-05-19' }),
      totalInstallmentsOverride: 6,
    })
    expect(action).toEqual({
      kind: 'carryover',
      installmentAmount: 500,
      totalInstallments: 6,
      paidInstallments: 2,
      nextDueDate: '2026-07-19',
    })
  })

  it('manuel akış: override 1 → tek çekim gibi (taksit planı kurulmaz)', () => {
    expect(
      resolveStatementImportAction({
        transaction: tx({ isInstallment: true, installmentNo: 1, installmentCount: 0, amount: 500, date: '2026-05-19' }),
        totalInstallmentsOverride: 1,
      }),
    ).toEqual({ kind: 'expense', amount: 500, spentAt: '2026-05-19', installmentCount: 1 })
  })
})
