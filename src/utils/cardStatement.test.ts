import { describe, expect, it } from 'vitest'
import { getCardStatementPeriod, getNextCardPaymentDueDate } from './cardStatement'

function credit(statement_day: number | null, due_day: number | null) {
  return { card_type: 'kredi_karti' as const, statement_day, due_day }
}

describe('getCardStatementPeriod', () => {
  it('returns null for bank cards or missing statement/due days', () => {
    expect(getCardStatementPeriod({ card_type: 'banka_karti', statement_day: 15, due_day: 5 }, '2026-06-10')).toBeNull()
    expect(getCardStatementPeriod(credit(null, 5), '2026-06-10')).toBeNull()
    expect(getCardStatementPeriod(credit(15, null), '2026-06-10')).toBeNull()
    expect(getCardStatementPeriod(null, '2026-06-10')).toBeNull()
  })

  it('keeps a spend before the statement day inside the current period', () => {
    const period = getCardStatementPeriod(credit(15, 5), '2026-06-10')
    expect(period?.periodStart).toBe('2026-05-16')
    expect(period?.periodEnd).toBe('2026-06-15')
    expect(period?.statementDate).toBe('2026-06-15')
    expect(period?.dueDate).toBe('2026-07-05')
  })

  it('treats a spend exactly on the statement day as the current period', () => {
    const period = getCardStatementPeriod(credit(15, 5), '2026-06-15')
    expect(period?.statementDate).toBe('2026-06-15')
    expect(period?.periodStart).toBe('2026-05-16')
  })

  it('rolls a spend after the statement day into the next period', () => {
    const period = getCardStatementPeriod(credit(15, 5), '2026-06-20')
    expect(period?.periodStart).toBe('2026-06-16')
    expect(period?.statementDate).toBe('2026-07-15')
    expect(period?.dueDate).toBe('2026-08-05')
  })

  it('keeps the due date in the statement month when the due day is after the statement day', () => {
    const period = getCardStatementPeriod(credit(5, 25), '2026-06-03')
    expect(period?.periodStart).toBe('2026-05-06')
    expect(period?.statementDate).toBe('2026-06-05')
    expect(period?.dueDate).toBe('2026-06-25')
  })

  it('clamps a 31st statement day to the last day of a short month', () => {
    const period = getCardStatementPeriod(credit(31, 10), '2026-02-15')
    expect(period?.periodStart).toBe('2026-02-01')
    expect(period?.statementDate).toBe('2026-02-28')
    expect(period?.dueDate).toBe('2026-03-10')
  })

  it('fills human-readable labels', () => {
    const period = getCardStatementPeriod(credit(15, 5), '2026-06-10')
    expect(period?.statementMonthLabel).toContain('2026')
    expect(period?.periodLabel).toContain('-')
  })
})

describe('getNextCardPaymentDueDate', () => {
  it('returns null without a credit-card due day', () => {
    expect(getNextCardPaymentDueDate({ card_type: 'banka_karti', statement_day: 15, due_day: 5 })).toBeNull()
    expect(getNextCardPaymentDueDate(credit(15, null))).toBeNull()
  })

  it('returns this month when the due day is still ahead', () => {
    expect(getNextCardPaymentDueDate(credit(15, 5), '2026-06-03')).toBe('2026-06-05')
  })

  it('includes the due day itself', () => {
    expect(getNextCardPaymentDueDate(credit(15, 5), '2026-06-05')).toBe('2026-06-05')
  })

  it('rolls to next month once the due day has passed', () => {
    expect(getNextCardPaymentDueDate(credit(15, 5), '2026-06-10')).toBe('2026-07-05')
  })
})
