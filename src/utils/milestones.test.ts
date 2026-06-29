import { describe, expect, it } from 'vitest'
import type { Asset, Card } from '../types/database'
import { detectMilestones, type MilestoneInput } from './milestones'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01', updated_at: '2026-01-01' }

function asset(o: Partial<Asset>): Asset {
  return { ...base, name: 'V', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...o }
}

function bankCard(o: Partial<Card>): Card {
  return {
    ...base, bank_name: 'B', card_name: 'Hesap', card_type: 'banka_karti', holder_name: null, account_number: null,
    limit_group_name: null, current_balance: 0, credit_limit: 0, debt_amount: 0, statement_debt_amount: 0,
    current_period_spending: 0, provision_amount: 0, statement_day: null, due_day: null, note: null, ...o,
  }
}

function input(o: Partial<MilestoneInput>): MilestoneInput {
  return { assets: [], cards: [], loans: [], cardExpenses: [], savingsGoals: [], netWorthSnapshots: [], ...o }
}

describe('detectMilestones cash threshold', () => {
  it('counts bank-card balances toward the savings milestone, not just Nakit assets', () => {
    const result = detectMilestones(input({
      assets: [asset({ category: 'Nakit', estimated_value_try: 6000 })],
      cards: [bankCard({ current_balance: 5000 })], // 6000 + 5000 = 11000 ≥ 10K
    }))
    expect(result.some((m) => m.id === 'cash-10000')).toBe(true)
  })

  it('does not award the milestone when combined cash is below the threshold', () => {
    const result = detectMilestones(input({
      assets: [asset({ category: 'Nakit', estimated_value_try: 6000 })],
      cards: [bankCard({ current_balance: 3000 })], // 9000 < 10K
    }))
    expect(result.some((m) => m.id.startsWith('cash-'))).toBe(false)
  })
})
