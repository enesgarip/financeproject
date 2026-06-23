import { describe, expect, it } from 'vitest'
import type { Card, Payment } from '../types/database'
import { buildAttentionLine, type AttentionUpcomingItem } from './attention'
import type { FinanceSummaryInput } from './financeSummary'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const FROM = new Date(2026, 5, 1) // 1 June 2026

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'banka_karti',
    holder_name: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 0,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: null,
    due_day: null,
    note: null,
    ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return { ...base, title: 'Ödeme', category: 'Fatura', amount: 0, amount_status: 'exact', due_date: '2026-06-15', status: 'bekliyor', payment_method: 'manual', recurrence: 'none', recurrence_day: null, recurrence_end_date: null, auto_source_card_id: null, note: null, ...overrides }
}

function buildInput(overrides: Partial<FinanceSummaryInput> = {}): FinanceSummaryInput {
  return { assets: [], cards: [], loans: [], loanInstallments: [], debts: [], payments: [], salaryHistory: [], cardInstallments: [], ...overrides }
}

function upcoming(daysFromNow: number, cashImpactAmount: number, settlement: 'cash' | 'credit_card' = 'cash'): AttentionUpcomingItem {
  return {
    cashImpactAmount,
    settlement,
    sortTime: FROM.getTime() + daysFromNow * 86_400_000,
    title: 'Yükümlülük',
  }
}

describe('buildAttentionLine', () => {
  it('stays silent when finances are healthy', () => {
    const data = buildInput({ cards: [card({ current_balance: 100_000 })] })
    expect(buildAttentionLine(data, [], FROM)).toBeNull()
  })

  it('flags an immediate 7-day cash shortfall as the top priority', () => {
    const data = buildInput({ cards: [card({ current_balance: 1_000 })] })
    const line = buildAttentionLine(data, [upcoming(3, 5_000)], FROM)
    expect(line?.tone).toBe('danger')
    expect(line?.text).toContain('7 günde')
    expect(line?.text).toContain('açık')
  })

  it('ignores card-settled and out-of-window obligations for the shortfall check', () => {
    const data = buildInput({ cards: [card({ current_balance: 1_000 })] })
    expect(buildAttentionLine(data, [upcoming(3, 5_000, 'credit_card')], FROM)).toBeNull()
    expect(buildAttentionLine(data, [upcoming(20, 5_000)], FROM)).toBeNull()
  })

  it('warns when the forecast goes negative within the horizon', () => {
    // 10k cash, a 9k bill every month, no income → negative by month two.
    const data = buildInput({
      cards: [card({ current_balance: 10_000 })],
      payments: [payment({ amount: 9_000, recurrence: 'monthly', recurrence_day: 20, due_date: '2026-06-20' })],
    })
    const line = buildAttentionLine(data, [], FROM)
    expect(line?.tone).toBe('danger')
    expect(line?.text).toContain('eksiye düşüyor')
  })

  it('gives a low-point heads-up when balance dips but stays positive', () => {
    // 10k cash, one-off 8k bill this month → lowest 2k = 20% of start (< 25%).
    const data = buildInput({
      cards: [card({ current_balance: 10_000 })],
      payments: [payment({ amount: 8_000, due_date: '2026-06-20' })],
    })
    const line = buildAttentionLine(data, [], FROM)
    expect(line?.tone).toBe('warning')
    expect(line?.text).toContain('en düşük noktası')
  })

  it('prefers the immediate shortfall over forecast warnings', () => {
    const data = buildInput({
      cards: [card({ current_balance: 1_000 })],
      payments: [payment({ amount: 9_000, recurrence: 'monthly', recurrence_day: 20, due_date: '2026-06-20' })],
    })
    const line = buildAttentionLine(data, [upcoming(2, 3_000)], FROM)
    expect(line?.text).toContain('7 günde')
  })
})
