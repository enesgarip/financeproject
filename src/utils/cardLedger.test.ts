import { describe, expect, it } from 'vitest'
import {
  groupEventsByCard,
  ledgerDrift,
  projectCardDebt,
  projectCardDebtKurus,
  projectDebtByCard,
  summarizeCardLedger,
  type CardLedgerEvent,
} from './cardLedger'

function ev(card_id: string, amount_kurus: number, kind: CardLedgerEvent['kind'] = 'debit'): CardLedgerEvent {
  return { card_id, amount_kurus, kind, occurred_at: '2026-06-10T00:00:00Z' }
}

describe('projectCardDebtKurus / projectCardDebt', () => {
  it('sums signed kuruş events exactly', () => {
    const events = [ev('a', 150000, 'opening'), ev('a', 4999, 'debit'), ev('a', -2500, 'credit')]
    expect(projectCardDebtKurus(events)).toBe(152499)
    expect(projectCardDebt(events)).toBe(1524.99)
  })

  it('returns 0 for no events', () => {
    expect(projectCardDebtKurus([])).toBe(0)
    expect(projectCardDebt([])).toBe(0)
  })

  it('handles a fully paid-off card (nets to zero)', () => {
    const events = [ev('a', 100000, 'opening'), ev('a', -100000, 'credit')]
    expect(projectCardDebt(events)).toBe(0)
  })
})

describe('groupEventsByCard / projectDebtByCard', () => {
  it('splits events per card and projects each', () => {
    const events = [ev('a', 100000, 'opening'), ev('b', 50000, 'opening'), ev('a', -30000, 'credit')]
    const grouped = groupEventsByCard(events)
    expect(grouped.get('a')).toHaveLength(2)
    expect(grouped.get('b')).toHaveLength(1)

    const byCard = projectDebtByCard(events)
    expect(byCard.get('a')).toBe(700)
    expect(byCard.get('b')).toBe(500)
  })
})

describe('ledgerDrift', () => {
  it('is zero when events explain the stored debt', () => {
    const events = [ev('a', 152499, 'opening')]
    expect(ledgerDrift(events, 1524.99)).toBe(0)
  })

  it('is positive when stored debt exceeds the ledger (untracked debit)', () => {
    const events = [ev('a', 100000, 'opening')]
    expect(ledgerDrift(events, 1050)).toBe(50)
  })

  it('is negative when the ledger exceeds the stored debt', () => {
    const events = [ev('a', 100000, 'opening')]
    expect(ledgerDrift(events, 990)).toBe(-10)
  })
})

describe('summarizeCardLedger', () => {
  it('breaks down debit vs credit and nets out', () => {
    const events = [
      ev('a', 100000, 'opening'),
      ev('a', 25000, 'debit'),
      ev('a', -40000, 'credit'),
      ev('a', -1000, 'credit'),
    ]
    const summary = summarizeCardLedger(events)
    expect(summary.count).toBe(4)
    expect(summary.totalDebit).toBe(1250)
    expect(summary.totalCredit).toBe(410)
    expect(summary.net).toBe(840)
  })

  it('is empty-safe', () => {
    expect(summarizeCardLedger([])).toEqual({ count: 0, totalDebit: 0, totalCredit: 0, net: 0 })
  })
})
