import { describe, expect, it } from 'vitest'
import type { Asset, Card, Debt } from '../types/database'
import type { FinanceSummaryInput } from './financeSummary'
import type { MarketRatesSnapshot } from './marketRates'
import { computeZakat, ZAKAT_NISAB_GOLD_GRAMS } from './zakat'

function snap(gramBuying: number): MarketRatesSnapshot {
  return { rates: { GRA: { buying: gramBuying, selling: gramBuying } }, asOf: null, fetchedAt: '2026-01-01T00:00:00Z' }
}

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'V', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...overrides }
}

function creditCard(overrides: Partial<Card>): Card {
  return {
    ...base, bank_name: 'B', card_name: 'KK', card_type: 'kredi_karti', holder_name: null, account_number: null, limit_group_name: null,
    current_balance: 0, credit_limit: 100000, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0,
    provision_amount: 0, statement_day: 1, due_day: 10, note: null, ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base, person_name: 'K', direction: 'borç_aldım', value_type: 'TRY', currency: null, amount: 0,
    estimated_value_try: 0, auto_valued: false, due_date: null, status: 'açık', note: null, ...overrides,
  }
}

function input(overrides: Partial<FinanceSummaryInput>): FinanceSummaryInput {
  return {
    assets: [], cards: [], loans: [], loanInstallments: [], debts: [], payments: [],
    salaryHistory: [], cardInstallments: [], ...overrides,
  }
}

const GRAM = 1000 // → nisab = 80.18 * 1000 = 80,180 TL

describe('computeZakat', () => {
  it('computes nisab from the live gram-gold price', () => {
    const z = computeZakat(input({}), snap(GRAM))
    expect(z.nisabTry).toBe(ZAKAT_NISAB_GOLD_GRAMS * GRAM)
    expect(z.meetsNisab).toBe(false)
    expect(z.zakatDue).toBe(0)
  })

  it('charges 2.5% when net wealth is at/above nisab', () => {
    const z = computeZakat(input({ assets: [asset({ category: 'Nakit', estimated_value_try: 100000 })] }), snap(GRAM))
    expect(z.zakatableAssets).toBe(100000)
    expect(z.netWealth).toBe(100000)
    expect(z.meetsNisab).toBe(true)
    expect(z.zakatDue).toBe(2500)
  })

  it('does not charge below nisab', () => {
    const z = computeZakat(input({ assets: [asset({ category: 'Nakit', estimated_value_try: 50000 })] }), snap(GRAM))
    expect(z.meetsNisab).toBe(false)
    expect(z.zakatDue).toBe(0)
  })

  it('returns null nisab and no zakat when gram price is missing', () => {
    const z = computeZakat(input({ assets: [asset({ category: 'Nakit', estimated_value_try: 1_000_000 })] }), null)
    expect(z.nisabTry).toBeNull()
    expect(z.gramGoldPrice).toBeNull()
    expect(z.meetsNisab).toBe(false)
    expect(z.zakatDue).toBe(0)
  })

  it('includes gold and tradeable holdings but excludes Araç/Diğer', () => {
    const z = computeZakat(
      input({
        assets: [
          asset({ category: 'Altın', estimated_value_try: 40000 }),
          asset({ category: 'Hisse', estimated_value_try: 30000 }),
          asset({ category: 'Fon', estimated_value_try: 20000 }),
          asset({ category: 'Araç', estimated_value_try: 500000 }),
          asset({ category: 'Diğer', estimated_value_try: 9000 }),
        ],
      }),
      snap(GRAM),
    )
    expect(z.zakatableAssets).toBe(90000) // 40k + 30k + 20k, car & other excluded
  })

  it('deducts debts before the nisab check', () => {
    const z = computeZakat(
      input({
        assets: [asset({ category: 'Nakit', estimated_value_try: 100000 })],
        cards: [creditCard({ debt_amount: 30000 })],
      }),
      snap(GRAM),
    )
    expect(z.deductibleDebts).toBe(30000)
    expect(z.netWealth).toBe(70000) // below nisab now
    expect(z.meetsNisab).toBe(false)
  })

  it('keeps debts when deductDebts is false', () => {
    const z = computeZakat(
      input({
        assets: [asset({ category: 'Nakit', estimated_value_try: 100000 })],
        cards: [creditCard({ debt_amount: 30000 })],
      }),
      snap(GRAM),
      { deductDebts: false },
    )
    expect(z.deductibleDebts).toBe(0)
    expect(z.netWealth).toBe(100000)
    expect(z.zakatDue).toBe(2500)
  })

  it('honors the receivables toggle', () => {
    const data = input({
      assets: [asset({ category: 'Nakit', estimated_value_try: 50000 })],
      debts: [debt({ direction: 'borç_verdim', estimated_value_try: 50000 })],
    })
    expect(computeZakat(data, snap(GRAM), { includeReceivables: true }).zakatableAssets).toBe(100000)
    expect(computeZakat(data, snap(GRAM), { includeReceivables: false }).zakatableAssets).toBe(50000)
  })

  it('honors the BES toggle', () => {
    const data = input({ assets: [asset({ category: 'BES', estimated_value_try: 120000 })] })
    expect(computeZakat(data, snap(GRAM), { includeBes: false }).zakatableAssets).toBe(0)
    expect(computeZakat(data, snap(GRAM), { includeBes: true }).zakatableAssets).toBe(120000)
  })

  it('values gold from the live snapshot so the holding and nisab move together', () => {
    // 100 g auto-valued gold; stored value is deliberately stale (1 TL).
    const goldAsset = asset({ category: 'Altın', unit: 'gram', amount: 100, auto_valued: true, estimated_value_try: 1 })

    const z = computeZakat(input({ assets: [goldAsset] }), snap(1000))
    // Gold is valued live (100 g × 1000), NOT from the stale stored 1 TL.
    expect(z.zakatableAssets).toBe(100000)
    expect(z.nisabTry).toBe(ZAKAT_NISAB_GOLD_GRAMS * 1000)
    // 100 g > 80.18 g nisab → meets at any price, because gold and nisab share
    // the same live source (the old bug could flip this with a stale stored value).
    expect(z.meetsNisab).toBe(true)
  })
})
