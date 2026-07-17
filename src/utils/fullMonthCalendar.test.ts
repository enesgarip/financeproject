import { describe, expect, it } from 'vitest'
import type { FinanceObligationsInput } from './obligations'
import type { SalaryHistory } from '../types/database'
import { buildFullMonthCalendar } from './fullMonthCalendar'

const emptyInput: FinanceObligationsInput = {
  cards: [],
  payments: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  cardInstallments: [],
  cardStatements: [],
}

const salary = (amount: number): SalaryHistory => ({
  id: 'salary-1',
  user_id: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  title: 'Maaş',
  amount,
  effective_date: '2026-01-01',
  note: null,
})

describe('buildFullMonthCalendar', () => {
  it('does not add an already received salary to the current cash balance again', () => {
    const result = buildFullMonthCalendar(emptyInput, [], [salary(20_000)], 10_000, new Date(2026, 6, 18))
    const salaryDay = result.days.find((day) => day.events.some((event) => event.kind === 'salary'))

    expect(salaryDay?.events[0]?.amount).toBe(20_000)
    expect(salaryDay?.netCashImpact).toBe(0)
    expect(result.totalIncome).toBe(0)
    expect(result.endBalance).toBe(10_000)
  })
})
