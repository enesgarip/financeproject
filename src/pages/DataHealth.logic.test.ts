import { describe, expect, it } from 'vitest'
import type { AccountLedger, Asset, Card, CardLedger } from '../types/database'
import { buildIssues, emptyData } from './DataHealth.logic'

const base = {
  id: 'asset-1',
  user_id: 'user-1',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    ...base,
    name: 'Varlık',
    category: 'Nakit',
    amount: 1,
    unit: 'TRY',
    currency: 'TRY',
    symbol: null,
    unit_cost: null,
    estimated_value_try: 1000,
    auto_valued: false,
    source: null,
    note: null,
    ...overrides,
  }
}

describe('buildIssues asset health checks', () => {
  it('does not normalize stock share quantity as a stale technical asset amount', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'stock-1',
          name: 'THYAO',
          category: 'Hisse',
          amount: 42,
          unit: 'TRY',
          currency: null,
          symbol: 'THYAO',
          unit_cost: 250,
          auto_valued: true,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-stock-1')).toBeUndefined()
  })

  it('still normalizes non-stock non-gold technical amount fields', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'fund-1',
          name: 'Fon',
          category: 'Fon',
          amount: 42,
          unit: 'adet',
          currency: null,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-fund-1')?.payload?.updates).toEqual({
      amount: 1,
      unit: 'TRY',
    })
  })

  it('fixes only the technical unit for stocks and keeps the share count intact', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'stock-unit-1',
          name: 'GARAN',
          category: 'Hisse',
          amount: 35,
          unit: 'adet',
          currency: null,
          symbol: 'GARAN',
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-stock-unit-1')?.payload?.updates).toEqual({
      unit: 'TRY',
    })
  })
})

function creditCard(overrides: Partial<Card> = {}): Card {
  return {
    ...base,
    id: 'card-1',
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'kredi_karti',
    holder_name: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 10000,
    debt_amount: 120,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: 1,
    due_day: 10,
    note: null,
    ...overrides,
  }
}

function ledgerEvent(overrides: Partial<CardLedger> = {}): CardLedger {
  return {
    ...base,
    id: 'ledger-1',
    card_id: 'card-1',
    occurred_at: '2026-06-01T00:00:00.000Z',
    kind: 'opening',
    amount_kurus: 10000,
    note: null,
    source_table: 'cards',
    source_id: 'card-1',
    ...overrides,
  }
}

describe('buildIssues card ledger drift (A2.1)', () => {
  it('flags a fixable drift when stored debt differs from the ledger projection', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 120 })],
      cardLedger: [ledgerEvent({ amount_kurus: 10000 })], // projection = 100 TL
    })

    const drift = issues.find((issue) => issue.id === 'card-ledger-drift-card-1')
    expect(drift?.kind).toBe('cardLedgerDrift')
    expect(drift?.fixable).toBe(true)
    expect(drift?.payload?.nextDebtAmount).toBe(100)
  })

  it('does not flag when the projection equals the stored debt', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 100 })],
      cardLedger: [ledgerEvent({ amount_kurus: 10000 })],
    })

    expect(issues.find((issue) => issue.id === 'card-ledger-drift-card-1')).toBeUndefined()
  })

  it('does not flag when the card has no ledger events (table not deployed / empty)', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 120 })],
      cardLedger: [],
    })

    expect(issues.find((issue) => issue.id === 'card-ledger-drift-card-1')).toBeUndefined()
  })
})

function bankCard(overrides: Partial<Card> = {}): Card {
  return creditCard({
    id: 'bank-1',
    card_type: 'banka_karti',
    current_balance: 1200,
    credit_limit: 0,
    debt_amount: 0,
    statement_day: null,
    due_day: null,
    ...overrides,
  })
}

function accountEvent(overrides: Partial<AccountLedger> = {}): AccountLedger {
  return {
    ...base,
    id: 'acct-1',
    card_id: 'bank-1',
    occurred_at: '2026-06-01T00:00:00.000Z',
    kind: 'opening',
    amount_kurus: 100000,
    note: null,
    source_table: 'cards',
    source_id: 'bank-1',
    ...overrides,
  }
}

describe('buildIssues account ledger drift (Faz 3.1)', () => {
  it('flags a fixable drift when stored balance differs from the ledger projection', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [bankCard({ current_balance: 1200 })],
      accountLedger: [accountEvent({ amount_kurus: 100000 })], // projection = 1000 TL
    })

    const drift = issues.find((issue) => issue.id === 'account-ledger-drift-bank-1')
    expect(drift?.kind).toBe('accountLedgerDrift')
    expect(drift?.fixable).toBe(true)
    expect(drift?.payload?.nextDebtAmount).toBe(1000)
  })

  it('does not flag when the projection equals the stored balance', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [bankCard({ current_balance: 1000 })],
      accountLedger: [accountEvent({ amount_kurus: 100000 })],
    })

    expect(issues.find((issue) => issue.id === 'account-ledger-drift-bank-1')).toBeUndefined()
  })

  it('does not flag when the account has no ledger events', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [bankCard({ current_balance: 1200 })],
      accountLedger: [],
    })

    expect(issues.find((issue) => issue.id === 'account-ledger-drift-bank-1')).toBeUndefined()
  })
})
