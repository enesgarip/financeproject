import { describe, expect, it } from 'vitest'
import { statementAwaitingProvision } from './cardProvisionPosting'

describe('statementAwaitingProvision', () => {
  const expense = { card_id: 'card-1', spent_at: '2026-09-18' }

  it('locks a provision on or before an open statement cut', () => {
    expect(statementAwaitingProvision(expense, [
      { card_id: 'card-1', statement_date: '2026-09-18', status: 'open' },
    ])?.statement_date).toBe('2026-09-18')
  })

  it('keeps post-cut provisions actionable', () => {
    expect(statementAwaitingProvision(expense, [
      { card_id: 'card-1', statement_date: '2026-09-17', status: 'open' },
    ])).toBeNull()
  })

  it('ignores paid statements and other cards', () => {
    expect(statementAwaitingProvision(expense, [
      { card_id: 'card-1', statement_date: '2026-09-20', status: 'paid' },
      { card_id: 'card-2', statement_date: '2026-09-20', status: 'open' },
    ])).toBeNull()
  })
})
