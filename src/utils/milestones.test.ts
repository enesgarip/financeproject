import { describe, expect, it } from 'vitest'
import type { Asset, Card, CardExpense, NetWorthSnapshot } from '../types/database'
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

function creditCard(o: Partial<Card>): Card {
  return { ...bankCard({ card_type: 'kredi_karti', credit_limit: 20000, ...o }), current_balance: 0 }
}

function expense(id: string, spent_at: string, amount: number): CardExpense {
  return { ...base, id, card_id: 'c', statement_archive_id: null, spent_at, amount, description: 'Harcama', category: 'Market', installment_count: 1, installment_amount: amount, status: 'posted', posted_at: spent_at, note: null, transaction_fingerprint: null }
}

function snapshot(id: string, snapshot_date: string, net_worth: number): NetWorthSnapshot {
  return { ...base, id, snapshot_date, net_worth, gold_try: null, usd_try: null }
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

describe('detectMilestones accuracy rules', () => {
  it('uses the canonical shared credit limit instead of summing duplicate limits', () => {
    const result = detectMilestones(input({ cards: [
      creditCard({ id: 'c1', limit_group_name: 'Ortak', debt_amount: 4000 }),
      creditCard({ id: 'c2', limit_group_name: 'Ortak', debt_amount: 4000 }),
    ] }))
    expect(result.some((item) => item.id === 'credit-usage-healthy')).toBe(false)
  })

  it('requires three consecutive completed months for the spending-decrease milestone', () => {
    const result = detectMilestones(input({ cardExpenses: [
      expense('jan', '2026-01-01', 300),
      expense('mar', '2026-03-01', 200),
      expense('jul', '2026-07-01', 100),
    ] }), new Date(2026, 6, 15))
    expect(result.some((item) => item.id === 'spending-decrease-streak')).toBe(false)
  })

  it('compares monthly net-worth snapshots rather than two days in the same month', () => {
    const sameMonth = detectMilestones(input({ netWorthSnapshots: [
      snapshot('s1', '2026-07-01', 100),
      snapshot('s2', '2026-07-02', 200),
    ] }))
    expect(sameMonth.some((item) => item.id === 'net-worth-up')).toBe(false)

    const consecutiveMonths = detectMilestones(input({ netWorthSnapshots: [
      snapshot('s1', '2026-06-30', 100),
      snapshot('s2', '2026-07-02', 200),
    ] }))
    expect(consecutiveMonths.some((item) => item.id === 'net-worth-up')).toBe(true)
  })
})
