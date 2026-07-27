import { describe, expect, it } from 'vitest'
import type { CashFlowForecast, CashFlowForecastMonth } from './cashFlowForecast'
import { buildPurchaseImpact } from './purchaseImpact'

function month(label: string, endingBalance: number): CashFlowForecastMonth {
  return {
    monthKey: label,
    monthLabel: label,
    income: 0,
    outflow: 0,
    net: 0,
    endingBalance,
    salary: 0,
    receivables: 0,
    paymentOutflow: 0,
    cardOutflow: 0,
    loanOutflow: 0,
    installmentOutflow: 0,
    debtOutflow: 0,
  }
}

const forecast: CashFlowForecast = {
  startingBalance: 50000,
  endingBalance: 90000,
  months: [
    month('Temmuz', 50000),
    month('Ağustos', 60000),
    month('Eylül', 70000),
    month('Ekim', 80000),
    month('Kasım', 90000),
    month('Aralık', 100000),
  ],
  lowest: null,
  firstNegative: null,
}

describe('buildPurchaseImpact', () => {
  it('kartla taksitli alımda ilk yük bir sonraki aya düşer ve taksit boyunca birikir', () => {
    const result = buildPurchaseImpact({
      amount: 12000,
      installments: 3,
      method: 'card',
      forecast,
      safeToSpend: 20000,
      buffer: 5000,
    })

    expect(result.monthlyInstallment).toBe(4000)
    // Temmuz'a yük binmez (ekstre henüz ödenmedi)
    expect(result.months[0]!.charge).toBe(0)
    expect(result.months[0]!.after).toBe(50000)
    // Ağustos-Ekim: kümülatif 4000 / 8000 / 12000
    expect(result.months[1]!.after).toBe(56000)
    expect(result.months[2]!.after).toBe(62000)
    expect(result.months[3]!.after).toBe(68000)
    // Taksit bittikten sonra yük sabit kalır
    expect(result.months[4]!.after).toBe(78000)
  })

  it('nakit alımda para hemen çıkar', () => {
    const result = buildPurchaseImpact({
      amount: 10000,
      installments: 1,
      method: 'cash',
      forecast,
      safeToSpend: 20000,
      buffer: 5000,
    })
    expect(result.months[0]!.after).toBe(40000)
    expect(result.safeToSpendAfter).toBe(10000)
  })

  it('bakiyeyi eksiye düşüren alım zorlayıcı sayılır', () => {
    const tight: CashFlowForecast = {
      ...forecast,
      months: [month('Temmuz', 5000), month('Ağustos', 6000), month('Eylül', 7000)],
    }
    const result = buildPurchaseImpact({
      amount: 30000,
      installments: 3,
      method: 'card',
      forecast: tight,
      safeToSpend: 4000,
      buffer: 5000,
    })
    expect(result.verdict).toBe('zorlayici')
    expect(result.firstNegativeLabel).toBe('Ağustos')
  })

  it('tamponun altına inen alım dikkat sayılır', () => {
    // Ağustos'ta 60.000 → 4.000 kalır; tampon 5.000'in altı.
    const result = buildPurchaseImpact({
      amount: 56000,
      installments: 1,
      method: 'card',
      forecast,
      safeToSpend: 100000,
      buffer: 5000,
    })
    expect(result.verdict).toBe('dikkat')
    expect(result.lowestAfter).toBe(4000)
    expect(result.lowestLabel).toBe('Ağustos')
  })

  it('rahat alımda gerekçe yine de açıklanır', () => {
    const result = buildPurchaseImpact({
      amount: 1000,
      installments: 1,
      method: 'card',
      forecast,
      safeToSpend: 20000,
      buffer: 5000,
    })
    expect(result.verdict).toBe('rahat')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('harcanabilir tutarı aşan alım en az dikkat verir', () => {
    const result = buildPurchaseImpact({
      amount: 6000,
      installments: 1,
      method: 'card',
      forecast,
      safeToSpend: 3000,
      buffer: 0,
    })
    expect(result.verdict).toBe('dikkat')
    expect(result.safeToSpendAfter).toBe(-3000)
  })
})
