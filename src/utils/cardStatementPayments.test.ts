import { describe, expect, it } from 'vitest'
import type { CardStatementArchive, CardStatementPayment } from '../types/database'
import {
  buildStatementPaidMap,
  openStatementsRemainingTotal,
  openStatementsWithRemaining,
  statementPaidAmount,
  statementRemainingAmount,
} from './cardStatementPayments'

function archive(overrides: Partial<CardStatementArchive> & { id: string }): CardStatementArchive {
  return {
    user_id: 'user-1',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    card_id: 'card-1',
    period_year: 2026,
    period_month: 8,
    statement_date: '2026-08-01',
    due_date: '2026-08-10',
    statement_debt_amount: 1_000,
    current_period_spending: 1_000,
    total_debt_amount: 1_000,
    status: 'open',
    paid_at: null,
    payment_source_card_id: null,
    bank_statement_amount: null,
    reconciled_at: null,
    note: null,
    ...overrides,
  } as CardStatementArchive
}

function payment(archiveId: string, amount: number): Pick<CardStatementPayment, 'statement_archive_id' | 'amount'> {
  return { statement_archive_id: archiveId, amount }
}

describe('buildStatementPaidMap', () => {
  it('aynı arşivin ödemelerini kuruş hassasiyetinde toplar', () => {
    const paid = buildStatementPaidMap([payment('a', 0.1), payment('a', 0.2), payment('b', 500)])
    expect(paid.get('a')).toBe(0.3)
    expect(paid.get('b')).toBe(500)
  })

  it('ödeme yoksa boş harita döner', () => {
    expect(buildStatementPaidMap([]).size).toBe(0)
  })
})

describe('statementRemainingAmount', () => {
  it('ödeme yokken arşiv tutarını döndürür', () => {
    expect(statementRemainingAmount(archive({ id: 'a' }))).toBe(1_000)
  })

  it('kısmi ödemeyi düşer (arşiv tutarı değişmez)', () => {
    const row = archive({ id: 'a', statement_debt_amount: 1_000 })
    const paid = buildStatementPaidMap([payment('a', 400)])
    expect(statementRemainingAmount(row, paid)).toBe(600)
    expect(statementPaidAmount(row, paid)).toBe(400)
    expect(row.statement_debt_amount).toBe(1_000)
  })

  it('fazla ödemede 0 döner (negatife düşmez)', () => {
    const paid = buildStatementPaidMap([payment('a', 1_500)])
    expect(statementRemainingAmount(archive({ id: 'a' }), paid)).toBe(0)
  })

  it('float tozu biriktirmez', () => {
    const paid = buildStatementPaidMap([payment('a', 0.1), payment('a', 0.2)])
    expect(statementRemainingAmount(archive({ id: 'a', statement_debt_amount: 0.3 }), paid)).toBe(0)
  })
})

describe('openStatementsRemainingTotal', () => {
  const archives = [
    archive({ id: 'a', card_id: 'card-1', statement_debt_amount: 1_000 }),
    archive({ id: 'b', card_id: 'card-1', statement_debt_amount: 2_000 }),
    archive({ id: 'c', card_id: 'card-2', statement_debt_amount: 500 }),
    archive({ id: 'd', card_id: 'card-1', statement_debt_amount: 9_000, status: 'paid' }),
  ]
  const paid = buildStatementPaidMap([payment('a', 250), payment('c', 500)])

  it('açık arşivlerin kalanlarını toplar, ödenmişleri saymaz', () => {
    expect(openStatementsRemainingTotal(archives, paid)).toBe(2_750)
  })

  it('kart bazında daraltır', () => {
    expect(openStatementsRemainingTotal(archives, paid, 'card-1')).toBe(2_750)
    expect(openStatementsRemainingTotal(archives, paid, 'card-2')).toBe(0)
  })

  it('ödeme haritası verilmezse arşiv tutarlarını toplar', () => {
    expect(openStatementsRemainingTotal(archives)).toBe(3_500)
  })
})

describe('openStatementsWithRemaining', () => {
  it('tamamen ödenmiş ama hâlâ açık görünen arşivi listelemez', () => {
    const archives = [
      archive({ id: 'a', statement_debt_amount: 1_000 }),
      archive({ id: 'b', statement_debt_amount: 1_000 }),
    ]
    const paid = buildStatementPaidMap([payment('b', 1_000)])
    expect(openStatementsWithRemaining(archives, paid).map((row) => row.id)).toEqual(['a'])
  })
})
