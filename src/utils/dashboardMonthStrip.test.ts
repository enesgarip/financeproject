import { describe, expect, it } from 'vitest'
import { buildMonthStrip, monthStripTone, type MonthStripInput } from './dashboardMonthStrip'

function at(year: number, month: number, day: number) {
  return new Date(year, month - 1, day).getTime()
}

function item(day: number, amount: number, overrides: Partial<MonthStripInput> = {}): MonthStripInput {
  return {
    id: `d${day}`,
    title: `Vade ${day}`,
    amount,
    sortTime: at(2026, 8, day),
    tone: 'planned',
    ...overrides,
  }
}

describe('monthStripTone', () => {
  it('yükümlülük tiplerini dört sinyale indirir', () => {
    expect(monthStripTone('card_statement')).toBe('statement')
    expect(monthStripTone('card_debt')).toBe('statement')
    expect(monthStripTone('card_installment')).toBe('installment')
    expect(monthStripTone('loan_installment')).toBe('installment')
    expect(monthStripTone('legacy_loan_installment')).toBe('installment')
    expect(monthStripTone('salary')).toBe('income')
    expect(monthStripTone('personal_receivable')).toBe('income')
  })

  it('bilinmeyen tip beşinci renk açmaz, "planlı"ya düşer', () => {
    expect(monthStripTone('payment')).toBe('planned')
    expect(monthStripTone('personal_debt')).toBe('planned')
    expect(monthStripTone('bir_gun_eklenen_yeni_tip')).toBe('planned')
  })
})

describe('buildMonthStrip', () => {
  const from = new Date(2026, 7, 10) // 10 Ağustos 2026, ay 31 gün

  it('pencere bugünden ay sonuna; sonraki ayın vadesi girmez', () => {
    const strip = buildMonthStrip([item(13, 4180), item(22, 8940)], from)
    expect(strip.startDay).toBe(10)
    expect(strip.endDay).toBe(31)
    expect(strip.marks.map((mark) => mark.day)).toEqual([13, 22])

    const nextMonth = buildMonthStrip([{ ...item(1, 18500), sortTime: at(2026, 9, 1) }], from)
    expect(nextMonth.marks).toHaveLength(0)
  })

  it('geçmiş vadeyi eler (şerit kalan ayı okur)', () => {
    const strip = buildMonthStrip([item(3, 1000), item(10, 2000)], from)
    expect(strip.marks.map((mark) => mark.day)).toEqual([10])
  })

  it('konum bugünü 0, ay sonunu 100 kabul eder', () => {
    const strip = buildMonthStrip([item(10, 100), item(31, 100), item(20, 100)], from)
    const byDay = new Map(strip.marks.map((mark) => [mark.day, mark.positionPct]))
    expect(byDay.get(10)).toBe(0)
    expect(byDay.get(31)).toBe(100)
    expect(byDay.get(20)).toBeCloseTo((10 / 21) * 100, 5)
  })

  it('yükseklik en büyük tutara göre ölçeklenir ama küçük vade kaybolmaz', () => {
    const strip = buildMonthStrip([item(12, 10000), item(15, 100)], from)
    const byDay = new Map(strip.marks.map((mark) => [mark.day, mark.heightPct]))
    expect(byDay.get(12)).toBe(100)
    expect(byDay.get(15)).toBe(12)
  })

  it('ayın son günü: sıfıra bölme yok, tek çubuk ortalanır', () => {
    const lastDay = new Date(2026, 7, 31)
    const strip = buildMonthStrip([item(31, 500)], lastDay)
    expect(strip.marks[0].positionPct).toBe(50)
    expect(Number.isNaN(strip.marks[0].positionPct)).toBe(false)
    expect(strip.axis).toEqual([31])
  })

  it('boş pencerede eksen yine kurulur', () => {
    const strip = buildMonthStrip([], from)
    expect(strip.marks).toHaveLength(0)
    expect(strip.axis).toEqual([10, 15, 21, 26, 31])
  })

  it('negatif tutar (gelir) yüksekliği mutlak değerden alır', () => {
    const strip = buildMonthStrip([item(12, 5000), item(15, -5000, { tone: 'income' })], from)
    expect(strip.marks.every((mark) => mark.heightPct === 100)).toBe(true)
  })

  it('vadeler tarihe göre sıralı döner', () => {
    const strip = buildMonthStrip([item(28, 1), item(11, 1), item(19, 1)], from)
    expect(strip.marks.map((mark) => mark.day)).toEqual([11, 19, 28])
  })
})
