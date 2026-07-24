import { describe, expect, it } from 'vitest'
import { buildImportedInstallmentPlan } from './importedInstallmentPlan'

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
