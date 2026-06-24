import { describe, expect, it } from 'vitest'
import type { Card, CardStatementArchive } from '../types/database'
import {
  addMonthsToMonth,
  formatMonthLabel,
  getCreditCardStatus,
  isMonthValue,
  monthDateValue,
  monthInputValue,
  moneyShare,
  openStatementAmount,
  parseInstallmentNumber,
  visibleOpenStatementAmount,
} from './CardsPage.helpers'

function creditCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    user_id: 'u1',
    bank_name: 'Test Bankası',
    card_name: 'Kart',
    holder_name: null, account_number: null,
    card_type: 'kredi_karti',
    limit_group_name: null,
    credit_limit: 10000,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    current_balance: 0,
    statement_day: 1,
    due_day: 10,
    note: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Card
}

function statement(overrides: Partial<CardStatementArchive> = {}): CardStatementArchive {
  return {
    id: 's1',
    user_id: 'u1',
    card_id: 'c1',
    period_year: 2026,
    period_month: 6,
    statement_date: '2026-06-01',
    due_date: '2026-06-10',
    statement_debt_amount: 0,
    current_period_spending: 0,
    total_debt_amount: 0,
    status: 'open',
    paid_at: null,
    payment_source_card_id: null,
    reconciled_bank_amount: null,
    reconciled_at: null,
    reconciliation_note: null,
    note: null,
    created_at: '2026-06-01',
    updated_at: '2026-06-01',
    ...overrides,
  }
}

describe('getCreditCardStatus', () => {
  // Not: ödeme tarihi dalları enjekte edilemeyen new Date() kullanır; deterministik
  // kalmak için payableDebt=0 senaryolarını test ediyoruz (tarih dalları atlanır).
  it('marks high usage without payable debt as limit-heavy', () => {
    const card = creditCard({ statement_debt_amount: 0, current_period_spending: 0, due_day: 28 })
    const status = getCreditCardStatus(card, 85)
    expect(status.label).toBe('Limit kullanımı yüksek')
    expect(status.description).toBe('%85 kullanım')
  })

  it('returns normal with no payable debt', () => {
    const card = creditCard({ statement_debt_amount: 0, current_period_spending: 0, due_day: 28 })
    const status = getCreditCardStatus(card, 20)
    expect(status.label).toBe('Normal')
    expect(status.description).toBe('Ödenebilir borç yok')
  })
})

describe('month value helpers', () => {
  it('validates YYYY-MM format', () => {
    expect(isMonthValue('2026-06')).toBe(true)
    expect(isMonthValue('2026-6')).toBe(false)
    expect(isMonthValue('haziran')).toBe(false)
  })

  it('produces a first-of-month date string', () => {
    expect(monthDateValue('2026-06')).toBe('2026-06-01')
  })

  it('falls back to current month for malformed input', () => {
    expect(monthDateValue('bozuk')).toBe(`${monthInputValue()}-01`)
  })

  it('adds months across a year boundary', () => {
    expect(addMonthsToMonth('2026-11', 2)).toBe('2027-01-01')
    expect(addMonthsToMonth('2026-03', -4)).toBe('2025-11-01')
  })

  it('labels a month in Turkish, dash for invalid', () => {
    expect(formatMonthLabel('2026-06')).toBe('Haziran 2026')
    expect(formatMonthLabel('bozuk')).toBe('-')
  })
})

describe('moneyShare', () => {
  it('splits an amount evenly and rounds to kuruş', () => {
    expect(moneyShare(100, 3)).toBe(33.33)
    expect(moneyShare(90, 3)).toBe(30)
  })

  it('returns 0 for non-positive amounts', () => {
    expect(moneyShare(0, 4)).toBe(0)
    expect(moneyShare(-50, 4)).toBe(0)
  })

  it('treats zero pieces as a single share', () => {
    expect(moneyShare(120, 0)).toBe(120)
  })
})

describe('open statement amount helpers', () => {
  it('sums open statement archives for the card at kuruş precision', () => {
    const card = creditCard({ id: 'c1', statement_debt_amount: 500 })
    const statements = [
      statement({ id: 's1', card_id: 'c1', statement_debt_amount: 100.1 }),
      statement({ id: 's2', card_id: 'c1', statement_debt_amount: 200.2 }),
      statement({ id: 's3', card_id: 'c1', statement_debt_amount: 999, status: 'paid' }),
      statement({ id: 's4', card_id: 'other', statement_debt_amount: 999 }),
    ]

    expect(openStatementAmount(card, statements)).toBe(300.3)
    expect(visibleOpenStatementAmount(card, statements)).toBe(300.3)
  })

  it('falls back to the card statement debt when there is no open archive', () => {
    const card = creditCard({ statement_debt_amount: 500 })

    expect(visibleOpenStatementAmount(card, [])).toBe(500)
  })
})

describe('parseInstallmentNumber', () => {
  it('truncates numeric input', () => {
    expect(parseInstallmentNumber('5.9', 1)).toBe(5)
  })

  it('falls back on non-numeric input', () => {
    expect(parseInstallmentNumber('abc', 3)).toBe(3)
  })
})
