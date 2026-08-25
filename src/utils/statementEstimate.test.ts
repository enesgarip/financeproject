import { describe, expect, it } from 'vitest'
import type { CardInstallment } from '../types/database'
import { estimateStatementTotal } from './statementEstimate'

// Kesim ayın 28'i: 25 Ağustos'ta kesime 3 gün var (pencere içi).
const CARD = {
  id: 'c1',
  card_type: 'kredi_karti' as const,
  statement_day: 28,
  due_day: 10,
  current_period_spending: 8000,
}
const TODAY = new Date('2026-08-25T12:00:00')

let seq = 0
function inst(overrides: Partial<CardInstallment>): CardInstallment {
  seq += 1
  return {
    id: `i${seq}`,
    card_id: 'c1',
    due_month: '2026-08-01',
    amount: 1000,
    status: 'scheduled',
    ...overrides,
  } as CardInstallment
}

describe('estimateStatementTotal', () => {
  it('dönem içi kovaya ekstre ayının planlı taksitlerini ekler', () => {
    const estimate = estimateStatementTotal(
      CARD,
      [
        inst({ due_month: '2026-08-01', amount: 1200 }),
        inst({ due_month: '2026-08-15', amount: 800 }), // aynı ay, gün farkı önemsiz
        inst({ due_month: '2026-09-01', amount: 999 }), // sonraki ekstre
        inst({ due_month: '2026-08-01', amount: 999, status: 'posted' }), // zaten borçta
        inst({ due_month: '2026-08-01', amount: 999, card_id: 'c2' }), // başka kart
      ],
      TODAY,
    )
    expect(estimate).toEqual({ amount: 10000, daysToCut: 3, statementDate: '2026-08-28' })
  })

  it('kesim günü (0 gün) dahil, pencere dışı ve banka kartı hariç', () => {
    expect(estimateStatementTotal(CARD, [], new Date('2026-08-28T09:00:00'))!.daysToCut).toBe(0)
    expect(estimateStatementTotal(CARD, [], new Date('2026-08-10T09:00:00'))).toBeNull() // 18 gün var
    expect(estimateStatementTotal({ ...CARD, card_type: 'banka_karti' as const }, [], TODAY)).toBeNull()
  })

  it('taksitsiz kartta yalnız dönem içi kovayı söyler', () => {
    expect(estimateStatementTotal(CARD, [], TODAY)!.amount).toBe(8000)
  })
})
