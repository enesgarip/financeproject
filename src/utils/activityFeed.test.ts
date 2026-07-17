import { describe, expect, it } from 'vitest'
import type { TransactionHistory, TransactionHistoryType } from '../types/database'
import { buildActivityFeed } from './activityFeed'

function tx(type: TransactionHistoryType, title: string, note: string | null = null, source_table: string | null = null): TransactionHistory {
  return {
    id: `${type}-${title}`,
    user_id: 'user-1',
    created_at: '2026-07-01T12:00:00Z',
    updated_at: '2026-07-01T12:00:00Z',
    occurred_at: '2026-07-01T12:00:00Z',
    type,
    title,
    amount: 500,
    source_table,
    source_id: 'source-1',
    note,
  }
}

function direction(row: TransactionHistory) {
  return buildActivityFeed([], [], [row], [])[0]?.direction
}

describe('transaction history activity directions', () => {
  it('treats positive payment and loan magnitudes as outflows', () => {
    expect(direction(tx('payment', 'Kira ödendi'))).toBe('outflow')
    expect(direction(tx('loan', 'Kredi taksiti ödendi'))).toBe('outflow')
  })

  it('shows undo history as neutral because no automatic cash refund occurs', () => {
    expect(direction(tx('loan', 'Kredi taksiti ödemesi geri alındı'))).toBe('neutral')
  })

  it('derives account movement and transfer direction from semantics', () => {
    expect(direction(tx('transfer', 'Maaş hesabı para girişi'))).toBe('inflow')
    expect(direction(tx('transfer', 'Nakit hesabı para çıkışı'))).toBe('outflow')
    expect(direction(tx('transfer', 'Hesaplar arası transfer'))).toBe('neutral')
  })

  it('derives debt and asset directions without using amount sign', () => {
    expect(direction(tx('debt', 'Alacak kapandı', 'Banka hesabına tahsil edildi.'))).toBe('inflow')
    expect(direction(tx('debt', 'Borç kapandı', 'Banka hesabından ödendi.'))).toBe('outflow')
    expect(direction(tx('asset', 'Altın alındı'))).toBe('outflow')
    expect(direction(tx('asset', 'Altın satıldı'))).toBe('inflow')
  })

  it('shows statement cutting as neutral and expense cancellation as inflow', () => {
    expect(direction(tx('card', 'Kart ekstresi kesildi', null, 'card_statement_archives'))).toBe('neutral')
    expect(direction(tx('card', 'Market harcaması iptal edildi', null, 'card_expenses'))).toBe('inflow')
  })
})
