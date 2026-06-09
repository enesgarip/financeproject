import type { Asset, Card } from '../types/database'
import { roundTL as round2 } from './money'

/**
 * "Enflasyon kalkanı" — how much of your wealth sits in real/hard assets that
 * hold value vs. melting TL cash that inflation erodes.
 *
 * Melting  = TL cash: assets in the `Nakit` category + bank-card balances.
 * Protected = everything else (Altın, Hisse, Fon, BES, Araç, Diğer) — non-cash
 *             holdings that track real value better than cash.
 *
 * Pure and side-effect-free. Uses each asset's already-live `estimated_value_try`
 * (gold/stock prices are kept in sync elsewhere), so no rate input is needed.
 */

export type ShieldBucket = 'protected' | 'melting'

export type InflationShieldCategory = {
  category: string
  bucket: ShieldBucket
  value: number
}

export type InflationShieldSummary = {
  protectedValue: number
  meltingValue: number
  totalValue: number
  /** protectedValue / totalValue, in [0,1]; 0 when there is nothing to classify. */
  protectedRatio: number
  meltingRatio: number
  /** Per-category positive contributions, sorted by value desc. */
  categories: InflationShieldCategory[]
}

const CASH_CATEGORY = 'Nakit'

export function buildInflationShield(assets: Asset[], cards: Card[]): InflationShieldSummary {
  const byCategory = new Map<string, number>()

  for (const asset of assets) {
    const value = Number(asset.estimated_value_try) || 0
    if (value <= 0) continue
    byCategory.set(asset.category, (byCategory.get(asset.category) ?? 0) + value)
  }

  // Bank-card balances are TL cash — fold them into the Nakit bucket.
  const bankBalance = cards
    .filter((card) => card.card_type === 'banka_karti')
    .reduce((total, card) => total + (Number(card.current_balance) || 0), 0)
  if (bankBalance > 0) {
    byCategory.set(CASH_CATEGORY, (byCategory.get(CASH_CATEGORY) ?? 0) + bankBalance)
  }

  let protectedValue = 0
  let meltingValue = 0
  const categories: InflationShieldCategory[] = []

  for (const [category, rawValue] of byCategory) {
    const value = round2(rawValue)
    if (value <= 0) continue
    const bucket: ShieldBucket = category === CASH_CATEGORY ? 'melting' : 'protected'
    if (bucket === 'melting') meltingValue += value
    else protectedValue += value
    categories.push({ category, bucket, value })
  }

  categories.sort((a, b) => b.value - a.value)

  const totalValue = round2(protectedValue + meltingValue)
  return {
    protectedValue: round2(protectedValue),
    meltingValue: round2(meltingValue),
    totalValue,
    protectedRatio: totalValue > 0 ? protectedValue / totalValue : 0,
    meltingRatio: totalValue > 0 ? meltingValue / totalValue : 0,
    categories,
  }
}
