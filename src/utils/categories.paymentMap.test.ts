import { describe, expect, it } from 'vitest'
import { cardCategoryFromPayment, expenseCategories } from './categories'

describe('cardCategoryFromPayment (SQL ikizi: private.card_category_from_payment)', () => {
  it('kart taksonomisindeki adları aynen geçirir', () => {
    for (const category of expenseCategories) {
      expect(cardCategoryFromPayment(category)).toBe(category)
    }
  })

  it('yalnız ödeme taksonomisinde olan etiketleri eşler', () => {
    expect(cardCategoryFromPayment('Sigorta')).toBe('Finansman')
    expect(cardCategoryFromPayment('Vergi / devlet')).toBe('Finansman')
    expect(cardCategoryFromPayment('Kira / aidat')).toBe('Konut')
    expect(cardCategoryFromPayment('Dijital üyelik')).toBe('Abonelik')
  })

  it('bilinmeyen/boş etiketi Diğer yapar', () => {
    expect(cardCategoryFromPayment('')).toBe('Diğer')
    expect(cardCategoryFromPayment(null)).toBe('Diğer')
    expect(cardCategoryFromPayment('Rastgele')).toBe('Diğer')
  })
})
