import { describe, expect, it } from 'vitest'
import type { CardExpense } from '../types/database'
import { buildRepeatSuggestions } from './expenseRepeat'

function expense(partial: Partial<CardExpense>): CardExpense {
  return {
    id: crypto.randomUUID(),
    user_id: 'u',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    card_id: 'c1',
    statement_archive_id: null,
    spent_at: '2026-07-01',
    amount: 100,
    description: 'MIGROS',
    category: 'Market',
    installment_count: 1,
    installment_amount: 0,
    status: 'posted',
    posted_at: null,
    note: null,
    transaction_fingerprint: null,
    source: 'manual',
    ...partial,
  }
}

describe('buildRepeatSuggestions', () => {
  it('açıklamaya göre tekilleştirir (en yeni sıradaki kalır)', () => {
    const result = buildRepeatSuggestions([
      expense({ description: 'MIGROS', amount: 250 }),
      expense({ description: 'migros', amount: 100 }), // aynı satıcı (tr-TR normalize) → atlanır
      expense({ description: 'SHELL', amount: 900 }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ description: 'MIGROS', amount: 250, category: 'Market' })
    expect(result[1].description).toBe('SHELL')
  })

  it('taksitli ve provizyon kayıtları önerilmez', () => {
    const result = buildRepeatSuggestions([
      expense({ description: 'TAKSIT', installment_count: 6 }),
      expense({ description: 'PROVIZYON', status: 'provision' }),
      expense({ description: 'PESIN', amount: 50 }),
    ])
    expect(result.map((s) => s.description)).toEqual(['PESIN'])
  })

  it('limit kadar döner', () => {
    const rows = Array.from({ length: 10 }, (_, i) => expense({ description: `SATICI-${i}` }))
    expect(buildRepeatSuggestions(rows, 4)).toHaveLength(4)
  })

  it('boş kategoriyi Diğer yapar', () => {
    const result = buildRepeatSuggestions([expense({ description: 'X', category: '' })])
    expect(result[0].category).toBe('Diğer')
  })
})
