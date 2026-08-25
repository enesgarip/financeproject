import { describe, expect, it } from 'vitest'
import type { Budget, CardExpense } from '../types/database'
import {
  averageCategorySpend,
  budgetAnchorLabel,
  buildBudgetRollover,
  buildBudgetSuggestions,
  resolveBudgetRows,
} from './budgetAnchor'

const TODAY = new Date('2026-08-25T12:00:00')

let seq = 0
function expense(overrides: Partial<CardExpense>): CardExpense {
  seq += 1
  return {
    id: `e${seq}`,
    user_id: 'u1',
    created_at: '',
    updated_at: '',
    card_id: 'c1',
    spent_at: '2026-07-10',
    amount: 1000,
    description: 'Test',
    category: 'Market',
    status: 'posted',
    posted_at: null,
    source: 'manual',
    ...overrides,
  } as CardExpense
}

function budget(overrides: Partial<Budget>): Budget {
  seq += 1
  return {
    id: `b${seq}`,
    user_id: 'u1',
    created_at: '',
    updated_at: '',
    month: '2026-08-01',
    category: 'Market',
    limit_amount: 0,
    note: null,
    limit_anchor: 'manual',
    limit_anchor_value: null,
    ...overrides,
  } as Budget
}

describe('averageCategorySpend', () => {
  it('önceki 3 tam ayı ortalar; boş ay 0 sayılır, cari ay ve iptal dışarıda', () => {
    const expenses = [
      expense({ spent_at: '2026-07-10', amount: 9000 }),
      expense({ spent_at: '2026-06-05', amount: 6000 }),
      expense({ spent_at: '2026-06-20', amount: 3000 }),
      // Mayıs boş → 0. Cari ay (Ağustos) sayılmaz:
      expense({ spent_at: '2026-08-10', amount: 99999 }),
      expense({ spent_at: '2026-07-11', amount: 500, status: 'cancelled' }),
      expense({ spent_at: '2026-07-12', amount: 700, category: 'Ulaşım' }),
    ]
    expect(averageCategorySpend(expenses, 'Market', TODAY)).toBe(6000) // (9000+9000+0)/3
  })
})

describe('resolveBudgetRows', () => {
  const expenses = [
    expense({ spent_at: '2026-07-10', amount: 9000 }),
    expense({ spent_at: '2026-06-05', amount: 9000 }),
    expense({ spent_at: '2026-05-05', amount: 6000 }),
  ]

  it('avg_spend limiti satırın ayından önceki 3 aydan türetir', () => {
    const [resolved] = resolveBudgetRows([budget({ limit_anchor: 'avg_spend', limit_anchor_value: 1.5 })], expenses, null)
    expect(resolved.limit_amount).toBe(12000) // ort. 8000 × 1,5
  })

  it('salary_pct maaştan türetir; maaş yoksa saklı 0 kalır (uydurma yazılmaz)', () => {
    const anchored = budget({ limit_anchor: 'salary_pct', limit_anchor_value: 15 })
    const [withSalary] = resolveBudgetRows([anchored], [], 90000)
    expect(withSalary.limit_amount).toBe(13500)
    const [withoutSalary] = resolveBudgetRows([anchored], [], null)
    expect(withoutSalary.limit_amount).toBe(0)
  })

  it('manual satır referans olarak aynen geçer', () => {
    const manual = budget({ limit_amount: 5000 })
    const [resolved] = resolveBudgetRows([manual], expenses, 90000)
    expect(resolved).toBe(manual)
  })
})

describe('budgetAnchorLabel', () => {
  it('kural etiketini üretir, manual satırda susar', () => {
    expect(budgetAnchorLabel(budget({ limit_anchor: 'avg_spend', limit_anchor_value: 1.5 }))).toBe('Son 3 ay ort. × 1,5')
    expect(budgetAnchorLabel(budget({ limit_anchor: 'salary_pct', limit_anchor_value: 15 }))).toBe('Maaş %15')
    expect(budgetAnchorLabel(budget({}))).toBeNull()
  })
})

describe('buildBudgetSuggestions', () => {
  const history = [
    expense({ spent_at: '2026-07-10', amount: 9000 }),
    expense({ spent_at: '2026-06-05', amount: 10000 }),
    expense({ spent_at: '2026-05-05', amount: 8000 }),
  ]

  it('bayat limit için son 3 ayın medyanını önerir', () => {
    const suggestions = buildBudgetSuggestions([budget({ limit_amount: 6000 })], history, TODAY)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ category: 'Market', suggested: 9000, current: 6000 })
  })

  it('sapma eşiğin altındaysa susar (%10 VE 25 TL)', () => {
    expect(buildBudgetSuggestions([budget({ limit_amount: 8600 })], history, TODAY)).toHaveLength(0)
  })

  it('tek örnek yetmez; limiti hiç girilmemiş satırda öneri hep verilir', () => {
    const single = [expense({ spent_at: '2026-07-10', amount: 9000 })]
    expect(buildBudgetSuggestions([budget({ limit_amount: 0 })], single, TODAY)).toHaveLength(0)
    expect(buildBudgetSuggestions([budget({ limit_amount: 0 })], history, TODAY)).toHaveLength(1)
  })

  it('çıpalı satırı ve geçmiş ayın satırını atlar', () => {
    const anchored = budget({ limit_anchor: 'avg_spend', limit_anchor_value: 1, limit_amount: 0 })
    const pastMonth = budget({ month: '2026-07-01', limit_amount: 100 })
    expect(buildBudgetSuggestions([anchored, pastMonth], history, TODAY)).toHaveLength(0)
  })
})

describe('buildBudgetRollover', () => {
  it('geçen ayda olup bu ayda karşılığı olmayan satırları döndürür', () => {
    const rows = [
      budget({ month: '2026-07-01', category: 'Market' }),
      budget({ month: '2026-07-01', category: 'Ulaşım' }),
      budget({ month: '2026-08-01', category: 'Market' }),
      budget({ month: '2026-06-01', category: 'Eğlence' }), // iki ay önce: devre girmez
    ]
    const rollover = buildBudgetRollover(rows, TODAY)
    expect(rollover.map((row) => row.category)).toEqual(['Ulaşım'])
  })
})
