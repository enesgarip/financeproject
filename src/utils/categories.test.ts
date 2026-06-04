import { describe, expect, it } from 'vitest'
import { buildCategoryMemory, inferExpenseCategory, suggestExpenseCategory } from './categories'

describe('buildCategoryMemory', () => {
  it('learns the most frequent category per description', () => {
    const memory = buildCategoryMemory([
      { description: 'Spotify', category: 'Eğlence' },
      { description: 'spotify', category: 'Eğlence' },
      { description: 'Spotify ', category: 'Diğer' },
    ])
    expect(memory.get('spotify')).toBe('Eğlence')
  })

  it('ignores blank and unknown categories', () => {
    const memory = buildCategoryMemory([
      { description: 'Kuyumcu', category: 'Takı' },
      { description: '', category: 'Market' },
      { description: 'Berber', category: null },
    ])
    expect(memory.has('kuyumcu')).toBe(false)
    expect(memory.has('berber')).toBe(false)
    expect(memory.size).toBe(0)
  })
})

describe('suggestExpenseCategory', () => {
  const memory = buildCategoryMemory([
    { description: 'Kuaför Ayşe', category: 'Sağlık' },
    { description: 'Migros', category: 'Eğlence' }, // user's own (overrides the dictionary's Market)
  ])

  it('prefers the user history over the static dictionary', () => {
    expect(inferExpenseCategory('Migros')).toBe('Market')
    expect(suggestExpenseCategory('Migros', memory)).toBe('Eğlence')
  })

  it('matches a remembered merchant inside a longer description', () => {
    expect(suggestExpenseCategory('Kuaför Ayşe Bakırköy', memory)).toBe('Sağlık')
  })

  it('falls back to the keyword dictionary when memory has no match', () => {
    expect(suggestExpenseCategory('Shell benzin', memory)).toBe('Ulaşım')
  })

  it('returns null for an empty description', () => {
    expect(suggestExpenseCategory('   ', memory)).toBeNull()
  })
})
