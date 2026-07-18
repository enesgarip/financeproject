import { describe, expect, it } from 'vitest'
import type { CardExpense } from '../types/database'
import { buildYearEndReport } from './yearEndReport'

function expense(id: string, spent_at: string, amount: number): CardExpense {
  return { id, user_id: 'u', created_at: spent_at, updated_at: spent_at, card_id: 'c', statement_archive_id: null, spent_at, amount, description: 'Harcama', category: 'Market', installment_count: 1, installment_amount: amount, status: 'posted', posted_at: spent_at, note: null, transaction_fingerprint: null }
}

describe('buildYearEndReport monthly average', () => {
  it('divides the current-year total by elapsed calendar months, including zero months', () => {
    const report = buildYearEndReport([
      expense('jan', '2026-01-10', 30000),
      expense('jun', '2026-06-10', 30000),
    ], [], 2026, new Date(2026, 5, 20))
    expect(report.avgMonthlySpending).toBe(10000)
  })

  it('divides a completed year by twelve months', () => {
    const report = buildYearEndReport([expense('one', '2025-05-10', 12000)], [], 2025, new Date(2026, 5, 20))
    expect(report.avgMonthlySpending).toBe(1000)
  })
})
