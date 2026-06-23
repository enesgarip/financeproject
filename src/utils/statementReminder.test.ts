import { describe, expect, it } from 'vitest'
import type { Card, CardStatementArchive } from '../types/database'
import { buildStatementReminders } from './statementReminder'

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

describe('buildStatementReminders', () => {
  it('shows a ready reminder when the statement day has passed and no archive exists', () => {
    const reminders = buildStatementReminders([card()], [], new Date('2026-06-20T12:00:00'))

    expect(reminders).toHaveLength(1)
    expect(reminders[0]?.kind).toBe('ready')
  })

  it('does not repeat a ready reminder after the current period has been archived', () => {
    const reminders = buildStatementReminders([card()], [archive()], new Date('2026-06-20T12:00:00'))

    expect(reminders).toHaveLength(0)
  })

  it('shows an upcoming reminder for the next unarchived statement within three days', () => {
    const reminders = buildStatementReminders([card({ statement_day: 9 })], [archive()], new Date('2026-07-07T12:00:00'))

    expect(reminders).toHaveLength(1)
    expect(reminders[0]?.kind).toBe('upcoming')
    expect(reminders[0]?.daysUntilStatement).toBe(2)
  })
})
