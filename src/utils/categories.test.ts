import { describe, expect, it } from 'vitest'
import { buildCategoryMemory, explainExpenseCategory, inferExpenseCategory, suggestExpenseCategory } from './categories'

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

describe('inferExpenseCategory word boundaries', () => {
  it('does not categorise instalment ("taksit") rows as Ulaşım via the "taksi" keyword', () => {
    expect(inferExpenseCategory('BEYLER OPTİK Peş. Taksit 1.Tk Anapara')).not.toBe('Ulaşım')
    expect(inferExpenseCategory('NEOVA SİGORTA Peş. Taksit 3.Tk Anapara')).not.toBe('Ulaşım')
    expect(inferExpenseCategory('Taksitli İşlem')).not.toBe('Ulaşım')
  })

  it('still matches genuine whole-word keywords', () => {
    expect(inferExpenseCategory('Taksi durağı ödemesi')).toBe('Ulaşım')
    expect(inferExpenseCategory('SHELL PETROL')).toBe('Ulaşım')
    expect(inferExpenseCategory('ŞOK MARKET')).toBe('Market')
    expect(inferExpenseCategory('BP AKARYAKIT')).toBe('Ulaşım')
  })

  it('does not latch a short keyword onto a larger word', () => {
    // "bp" must not match inside another token, "dis" must not match "disko"
    expect(inferExpenseCategory('ABPLAST SANAYI')).not.toBe('Ulaşım')
    expect(inferExpenseCategory('DISKO GECESI')).not.toBe('Sağlık')
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

describe('explainExpenseCategory', () => {
  const memory = buildCategoryMemory([
    { description: 'Kuaför Ayşe', category: 'Sağlık' },
    { description: 'Migros', category: 'Eğlence' },
  ])

  it('explains an exact memory hit', () => {
    expect(explainExpenseCategory('Migros', memory)).toEqual({
      category: 'Eğlence',
      source: 'memory-exact',
      match: 'migros',
    })
  })

  it('explains a partial memory hit with the remembered key', () => {
    expect(explainExpenseCategory('Kuaför Ayşe Bakırköy', memory)).toEqual({
      category: 'Sağlık',
      source: 'memory-partial',
      match: 'kuaför ayşe',
    })
  })

  it('explains a keyword hit with the exact keyword that matched', () => {
    expect(explainExpenseCategory('SHELL ISTASYONU ANKARA')).toEqual({
      category: 'Ulaşım',
      source: 'keyword',
      match: 'shell',
    })
    expect(explainExpenseCategory('NETFLIX.COM')).toEqual({
      category: 'Eğlence',
      source: 'keyword',
      match: 'netflix',
    })
  })

  it('returns null when nothing matches', () => {
    expect(explainExpenseCategory('KUYUMCU ALTIN')).toBeNull()
    expect(explainExpenseCategory('')).toBeNull()
  })

  it('stays consistent with suggestExpenseCategory', () => {
    for (const desc of ['Migros', 'SHELL PETROL', 'KUYUMCU ALTIN', 'Kuaför Ayşe Bakırköy']) {
      expect(explainExpenseCategory(desc, memory)?.category ?? null).toBe(suggestExpenseCategory(desc, memory))
    }
  })
})
