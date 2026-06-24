import { describe, expect, it } from 'vitest'
import { cardConsistencyScore } from './cardConsistency'
import type { Card } from '../types/database'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    user_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    card_name: 'Test Card',
    bank_name: 'Test Bank',
    card_type: 'kredi_karti',
    credit_limit: 10000,
    debt_amount: 1000,
    statement_debt_amount: 500,
    current_period_spending: 500,
    provision_amount: 0,
    statement_day: 15,
    due_day: 5,
    current_balance: 0,
    holder_name: null, account_number: null,
    limit_group_name: null,
    note: null,
    ...overrides,
  } as Card
}

describe('cardConsistencyScore', () => {
  it('returns 100 for a fully consistent credit card', () => {
    const card = makeCard()
    const ledger = [
      { card_id: 'c1', amount_kurus: 100000 },
    ]
    const result = cardConsistencyScore(card, ledger as never[], [], [])
    expect(result.score).toBe(100)
    expect(result.checks.every((c) => c.ok)).toBe(true)
  })

  it('detects ledger drift', () => {
    const card = makeCard({ debt_amount: 1000 })
    const ledger = [
      { card_id: 'c1', amount_kurus: 200000 },
    ]
    const result = cardConsistencyScore(card, ledger as never[], [], [])
    const ledgerCheck = result.checks.find((c) => c.label === 'Borç ↔ ledger')
    expect(ledgerCheck?.ok).toBe(false)
    expect(result.score).toBeLessThan(100)
  })

  it('detects limit overflow', () => {
    const card = makeCard({ debt_amount: 15000, credit_limit: 10000, statement_debt_amount: 15000, current_period_spending: 0 })
    const result = cardConsistencyScore(card, [], [], [])
    const limitCheck = result.checks.find((c) => c.label === 'Limit aşımı')
    expect(limitCheck?.ok).toBe(false)
  })

  it('scores bank card correctly', () => {
    const card = makeCard({
      card_type: 'banka_karti',
      credit_limit: 0,
      debt_amount: 0,
      statement_debt_amount: 0,
      current_period_spending: 0,
      current_balance: 5000,
    })
    const result = cardConsistencyScore(card, [], [], [])
    expect(result.score).toBe(100)
  })
})
