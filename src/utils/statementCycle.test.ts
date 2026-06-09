import { describe, expect, it } from 'vitest'
import type { Card, CardStatementArchive } from '../types/database'
import {
  canCutCurrentStatement,
  hasStatementArchiveForPeriod,
  nextUncutStatementDate,
} from './statementCycle'

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    user_id: 'user-1',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    bank_name: 'Bank',
    card_name: 'Card',
    card_type: 'kredi_karti',
    holder_name: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 10000,
    debt_amount: 1200,
    statement_debt_amount: 0,
    current_period_spending: 1200,
    provision_amount: 0,
    statement_day: 9,
    due_day: 20,
    note: null,
    ...overrides,
  }
}

function archive(overrides: Partial<CardStatementArchive> = {}): CardStatementArchive {
  return {
    id: 'statement-1',
    user_id: 'user-1',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    card_id: 'card-1',
    period_year: 2026,
    period_month: 6,
    statement_date: '2026-06-09',
    due_date: '2026-06-20',
    statement_debt_amount: 1200,
    current_period_spending: 1200,
    total_debt_amount: 1200,
    status: 'paid',
    paid_at: '2026-06-20T00:00:00.000Z',
    payment_source_card_id: 'account-1',
    reconciled_bank_amount: null,
    reconciled_at: null,
    reconciliation_note: null,
    note: null,
    ...overrides,
  }
}

describe('statement cycle helpers', () => {
  it('detects a statement archive for the current period regardless of status', () => {
    expect(hasStatementArchiveForPeriod('card-1', [archive()], new Date('2026-06-20T12:00:00'))).toBe(true)
    expect(hasStatementArchiveForPeriod('card-1', [archive({ status: 'open' })], new Date('2026-06-20T12:00:00'))).toBe(true)
    expect(hasStatementArchiveForPeriod('card-1', [archive()], new Date('2026-07-01T12:00:00'))).toBe(false)
  })

  it('allows cutting the day after the statement day when no archive exists', () => {
    expect(canCutCurrentStatement(card(), [], new Date('2026-06-10T12:00:00'))).toBe(true)
    expect(canCutCurrentStatement(card(), [], new Date('2026-06-20T12:00:00'))).toBe(true)
  })

  it('blocks cutting on or before the statement day or without current spending', () => {
    // The statement day's own spending belongs to that statement, so we only cut once it is over.
    expect(canCutCurrentStatement(card(), [], new Date('2026-06-09T12:00:00'))).toBe(false)
    expect(canCutCurrentStatement(card(), [], new Date('2026-06-08T12:00:00'))).toBe(false)
    expect(canCutCurrentStatement(card({ current_period_spending: 0 }), [], new Date('2026-06-20T12:00:00'))).toBe(false)
  })

  it('respects a clamped month-end statement day without cutting early', () => {
    // statement_day 31 in a 30-day month (June) clamps to the 30th. The client
    // predicate only flags the current month, so it never cuts early; the June 30
    // boundary itself is handled by the unconditional cut_due_card_statements RPC
    // (dashboard load + daily cron), which mirrors this clamp server-side.
    const monthEndCard = card({ statement_day: 31 })
    expect(canCutCurrentStatement(monthEndCard, [], new Date('2026-06-29T12:00:00'))).toBe(false)
    expect(canCutCurrentStatement(monthEndCard, [], new Date('2026-06-30T12:00:00'))).toBe(false)
  })

  it('blocks cutting when the current period already has an archive', () => {
    expect(canCutCurrentStatement(card(), [archive()], new Date('2026-06-20T12:00:00'))).toBe(false)
  })

  it('moves reminders to the next statement when the current period is archived', () => {
    expect(nextUncutStatementDate(card(), [archive()], new Date('2026-06-20T12:00:00'))?.toLocaleDateString('sv-SE')).toBe('2026-07-09')
    expect(nextUncutStatementDate(card(), [], new Date('2026-06-20T12:00:00'))?.toLocaleDateString('sv-SE')).toBe('2026-06-09')
  })
})
