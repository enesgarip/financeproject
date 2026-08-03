import { describe, expect, it } from 'vitest'
import { buildImportedInstallmentPlan, checkInstallmentNotation } from './importedInstallmentPlan'

describe('buildImportedInstallmentPlan', () => {
  it('keeps the original day and derives the current installment date', () => {
    expect(buildImportedInstallmentPlan({
      originalDate: '2026-05-19',
      installmentNo: 2,
      totalInstallments: 12,
      installmentAmount: 1_000,
    })).toEqual({
      originalDate: '2026-05-19',
      currentInstallmentDate: '2026-06-19',
      installmentNo: 2,
      totalInstallments: 12,
      paidInstallments: 1,
      remainingInstallments: 11,
      totalAmount: 12_000,
      remainingAmount: 11_000,
    })
  })

  it('keeps the last installment as the last row of the original plan', () => {
    const result = buildImportedInstallmentPlan({
      originalDate: '2025-08-31',
      installmentNo: 12,
      totalInstallments: 12,
      installmentAmount: 250,
    })

    expect(result.currentInstallmentDate).toBe('2026-07-31')
    expect(result.paidInstallments).toBe(11)
    expect(result.remainingInstallments).toBe(1)
  })
})

describe('checkInstallmentNotation', () => {
  it('accepts a consistent notation (kalan ≈ aylık × kalan-adet)', () => {
    // BEYLER 43.333,33/3-1: 21.666,67 × 2 = 43.333,34 ≈ 43.333,33
    expect(checkInstallmentNotation({
      installmentAmount: 21666.67,
      installmentNo: 1,
      totalInstallments: 3,
      remainingDebt: 43333.33,
    }).consistent).toBe(true)

    // NEOVA 12.033,65/9-3: 2.005,61 × 6 = 12.033,66 ≈ 12.033,65
    expect(checkInstallmentNotation({
      installmentAmount: 2005.61,
      installmentNo: 3,
      totalInstallments: 9,
      remainingDebt: 12033.65,
    }).consistent).toBe(true)
  })

  it('treats a zero remaining on the last installment as consistent', () => {
    expect(checkInstallmentNotation({
      installmentAmount: 1000,
      installmentNo: 6,
      totalInstallments: 6,
      remainingDebt: 0,
    })).toMatchObject({ consistent: true, expectedRemaining: 0 })
  })

  it('rejects a wrong total count (off by a full monthly amount)', () => {
    // Toplam 6 okunmuş ama kalan gerçekte 3 taksitlik → 1.000 × 5 = 5.000 ≠ 3.000
    const check = checkInstallmentNotation({
      installmentAmount: 1000,
      installmentNo: 1,
      totalInstallments: 6,
      remainingDebt: 3000,
    })
    expect(check.consistent).toBe(false)
    expect(check.expectedRemaining).toBe(5000)
    expect(check.diffTL).toBeCloseTo(-2000)
  })

  it('tolerates a kuruş-level uneven-installment drift', () => {
    // Kalan birkaç kuruş sapmalı (eşit olmayan taksit) → yine de tutarlı say.
    expect(checkInstallmentNotation({
      installmentAmount: 1000,
      installmentNo: 1,
      totalInstallments: 4,
      remainingDebt: 3000.03,
    }).consistent).toBe(true)
  })
})
