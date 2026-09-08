import { describe, expect, it } from 'vitest'
import { mergeCategoryTail } from './categoryComposition'
import { sumTL } from './money'

const totals = [
  { category: 'Market', amount: 4050 },
  { category: 'Alışveriş', amount: 3300 },
  { category: 'Ulaşım', amount: 2450 },
  { category: 'Yeme & İçme', amount: 2000 },
  { category: 'Kişisel Bakım', amount: 1000 },
  { category: 'Sağlık', amount: 600 },
  { category: 'Eğlence', amount: 300 },
  { category: 'Abonelik', amount: 200 },
]

describe('mergeCategoryTail', () => {
  it('sığıyorsa hiçbir şeyi birleştirmez, tutara göre sıralar', () => {
    const result = mergeCategoryTail(totals.slice(0, 5).reverse(), 6)
    expect(result.map((item) => item.category)).toEqual(['Market', 'Alışveriş', 'Ulaşım', 'Yeme & İçme', 'Kişisel Bakım'])
  })

  it('kuyruğu Diğer altında toplar; toplam değişmez (B6 — 13.900 vs 13.700 hatası)', () => {
    const result = mergeCategoryTail(totals, 6)
    expect(result).toHaveLength(6)
    expect(result.at(-1)).toEqual({ category: 'Diğer', amount: 600 + 300 + 200 })
    expect(sumTL(result.map((item) => item.amount))).toBe(sumTL(totals.map((item) => item.amount)))
  })

  it('gerçek Diğer kategorisi kuyrukla birleşir ve tek slot kullanır', () => {
    const withOther = [{ category: 'Diğer', amount: 5000 }, ...totals]
    const result = mergeCategoryTail(withOther, 4)
    expect(result.map((item) => item.category)).toEqual(['Market', 'Alışveriş', 'Ulaşım', 'Diğer'])
    expect(result[3].amount).toBe(5000 + 2000 + 1000 + 600 + 300 + 200)
  })
})
