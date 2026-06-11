import { describe, expect, it } from 'vitest'
import {
  balanceDrift,
  groupEventsByAccount,
  projectAccountBalance,
  projectAccountBalanceKurus,
  projectBalanceByAccount,
  summarizeAccountLedger,
  type AccountLedgerEvent,
} from './accountLedger'

function ev(card_id: string, amount_kurus: number, kind: AccountLedgerEvent['kind'] = 'deposit'): AccountLedgerEvent {
  return { card_id, amount_kurus, kind, occurred_at: '2026-06-12T00:00:00Z' }
}

describe('projectAccountBalanceKurus / projectAccountBalance', () => {
  it('sums signed kuruş events exactly', () => {
    const events = [ev('a', 100000, 'opening'), ev('a', 50000, 'deposit'), ev('a', -30000, 'withdrawal')]
    expect(projectAccountBalanceKurus(events)).toBe(120000)
    expect(projectAccountBalance(events)).toBe(1200)
  })

  it('returns 0 for no events', () => {
    expect(projectAccountBalanceKurus([])).toBe(0)
    expect(projectAccountBalance([])).toBe(0)
  })

  it('handles an emptied account (nets to zero)', () => {
    const events = [ev('a', 100000, 'opening'), ev('a', -100000, 'withdrawal')]
    expect(projectAccountBalance(events)).toBe(0)
  })
})

describe('groupEventsByAccount / projectBalanceByAccount', () => {
  it('splits events per account and projects each', () => {
    const events = [ev('a', 100000, 'opening'), ev('b', 50000, 'opening'), ev('a', -30000, 'withdrawal')]
    const grouped = groupEventsByAccount(events)
    expect(grouped.get('a')).toHaveLength(2)
    expect(grouped.get('b')).toHaveLength(1)

    const byAccount = projectBalanceByAccount(events)
    expect(byAccount.get('a')).toBe(700)
    expect(byAccount.get('b')).toBe(500)
  })
})

describe('balanceDrift', () => {
  it('is zero when events explain the stored balance', () => {
    const events = [ev('a', 120000, 'opening')]
    expect(balanceDrift(events, 1200)).toBe(0)
  })

  it('is positive when stored balance exceeds the ledger (untracked deposit)', () => {
    const events = [ev('a', 100000, 'opening')]
    expect(balanceDrift(events, 1050)).toBe(50)
  })

  it('is negative when the ledger exceeds the stored balance', () => {
    const events = [ev('a', 100000, 'opening')]
    expect(balanceDrift(events, 990)).toBe(-10)
  })
})

describe('summarizeAccountLedger', () => {
  it('breaks down deposits vs withdrawals and nets out', () => {
    const events = [
      ev('a', 100000, 'opening'),
      ev('a', 25000, 'deposit'),
      ev('a', -40000, 'withdrawal'),
      ev('a', -1000, 'withdrawal'),
    ]
    const summary = summarizeAccountLedger(events)
    expect(summary.count).toBe(4)
    expect(summary.totalIn).toBe(1250)
    expect(summary.totalOut).toBe(410)
    expect(summary.net).toBe(840)
  })

  it('is empty-safe', () => {
    expect(summarizeAccountLedger([])).toEqual({ count: 0, totalIn: 0, totalOut: 0, net: 0 })
  })
})
