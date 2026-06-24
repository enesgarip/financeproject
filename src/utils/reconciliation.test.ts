import { describe, expect, it } from 'vitest'
import type { AccountReconciliation, Card } from '../types/database'
import {
  appAmount,
  buildReconciliationItems,
  computeDrift,
  isReconciled,
  latestReconciliationByCard,
  reconcileTarget,
} from './reconciliation'

function card(over: Partial<Card> & Pick<Card, 'id' | 'card_type'>): Card {
  return {
    user_id: 'u1',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    bank_name: 'Bank',
    card_name: 'Card',
    holder_name: null, account_number: null,
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
    ...over,
  }
}

function recon(over: Partial<AccountReconciliation> & Pick<AccountReconciliation, 'card_id' | 'reconciled_at'>): AccountReconciliation {
  return {
    id: `r-${over.card_id}-${over.reconciled_at}`,
    user_id: 'u1',
    created_at: over.reconciled_at,
    updated_at: over.reconciled_at,
    target: 'balance',
    app_amount: 0,
    real_amount: 0,
    drift: 0,
    note: null,
    ...over,
  }
}

describe('reconcileTarget / appAmount', () => {
  it('uses debt for credit cards, balance for accounts', () => {
    const credit = card({ id: 'c', card_type: 'kredi_karti', debt_amount: 1500, current_balance: 999 })
    const account = card({ id: 'a', card_type: 'banka_karti', current_balance: 2500, debt_amount: 999 })
    expect(reconcileTarget(credit)).toBe('debt')
    expect(appAmount(credit)).toBe(1500)
    expect(reconcileTarget(account)).toBe('balance')
    expect(appAmount(account)).toBe(2500)
  })
})

describe('computeDrift / isReconciled', () => {
  it('drift is app − real at kuruş precision', () => {
    expect(computeDrift(1500.5, 1500)).toBe(0.5)
    expect(computeDrift(1000, 1250.25)).toBe(-250.25)
    expect(computeDrift(0.1 + 0.2, 0.3)).toBe(0)
  })

  it('isReconciled treats kuruş-equal as reconciled', () => {
    expect(isReconciled(0.1 + 0.2, 0.3)).toBe(true)
    expect(isReconciled(1000, 1000.01)).toBe(false)
  })
})

describe('latestReconciliationByCard', () => {
  it('keeps the most recent per card', () => {
    const rows = [
      recon({ card_id: 'a', reconciled_at: '2026-06-01T00:00:00Z', real_amount: 100 }),
      recon({ card_id: 'a', reconciled_at: '2026-06-09T00:00:00Z', real_amount: 200 }),
      recon({ card_id: 'b', reconciled_at: '2026-06-05T00:00:00Z', real_amount: 300 }),
    ]
    const latest = latestReconciliationByCard(rows)
    expect(latest.get('a')?.real_amount).toBe(200)
    expect(latest.get('b')?.real_amount).toBe(300)
  })
})

describe('buildReconciliationItems', () => {
  const today = new Date('2026-06-10T00:00:00Z')

  it('classifies never / ok / drift / stale and sorts most-actionable first', () => {
    const cards = [
      card({ id: 'ok', card_type: 'banka_karti', current_balance: 1000 }),
      card({ id: 'never', card_type: 'banka_karti', current_balance: 500 }),
      card({ id: 'drift', card_type: 'kredi_karti', debt_amount: 2000 }),
      card({ id: 'stale', card_type: 'banka_karti', current_balance: 750 }),
    ]
    const latest = new Map<string, AccountReconciliation>([
      ['ok', recon({ card_id: 'ok', reconciled_at: '2026-06-08T00:00:00Z', drift: 0 })],
      ['drift', recon({ card_id: 'drift', reconciled_at: '2026-06-09T00:00:00Z', target: 'debt', drift: 150 })],
      ['stale', recon({ card_id: 'stale', reconciled_at: '2026-04-01T00:00:00Z', drift: 0 })],
    ])

    const items = buildReconciliationItems(cards, latest, today)
    expect(items.map((i) => i.card.id)).toEqual(['drift', 'never', 'stale', 'ok'])

    const byId = new Map(items.map((i) => [i.card.id, i]))
    expect(byId.get('never')?.status).toBe('never')
    expect(byId.get('never')?.daysSince).toBeNull()
    expect(byId.get('drift')?.status).toBe('drift')
    expect(byId.get('ok')?.status).toBe('ok')
    expect(byId.get('ok')?.daysSince).toBe(2)
    expect(byId.get('stale')?.status).toBe('stale')
    expect(byId.get('stale')?.daysSince).toBe(70)
  })

  it('exposes the app figure per card', () => {
    const cards = [card({ id: 'c', card_type: 'kredi_karti', debt_amount: 3333 })]
    const items = buildReconciliationItems(cards, new Map(), today)
    expect(items[0].app).toBe(3333)
    expect(items[0].target).toBe('debt')
  })
})
