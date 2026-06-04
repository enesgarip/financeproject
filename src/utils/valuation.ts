import type { Asset, Debt, SavingsGoal } from '../types/database'
import { convertToTry, type MarketRatesSnapshot, type RateSide, type RateSymbol } from './marketRates'

/**
 * Domain valuation: maps an asset / debt / savings-goal row to the live market
 * symbol it should be valued against, and computes its TRY value from a rate
 * snapshot. Pure and snapshot-driven so it stays unit-testable.
 *
 * Side convention (which half of the buy/sell spread to use):
 *   - holdings & receivables → `buying` (Alış: what you'd get when selling)
 *   - obligations you owe     → `selling` (Satış: what it costs to settle)
 */

// --- Domain → market symbol (rate-independent) -----------------------------

export function assetRateSymbol(asset: Pick<Asset, 'category' | 'unit' | 'currency'>): RateSymbol | null {
  if (asset.category === 'Altın') {
    if (asset.unit === 'gram') return 'GRA'
    if (asset.unit === 'adet') return 'CEYREKALTIN'
    return null
  }
  if (asset.category === 'Nakit' && asset.currency && asset.currency !== 'TRY') {
    return asset.currency
  }
  return null
}

export function debtRateSymbol(debt: Pick<Debt, 'value_type' | 'currency'>): RateSymbol | null {
  if (debt.value_type === 'gram_altin') return 'GRA'
  if (debt.value_type === 'ceyrek_altin') return 'CEYREKALTIN'
  if (debt.value_type === 'doviz' && debt.currency && debt.currency !== 'TRY') return debt.currency
  return null
}

export function goalRateSymbol(goal: Pick<SavingsGoal, 'value_type'>): RateSymbol | null {
  if (goal.value_type === 'gram_altin') return 'GRA'
  if (goal.value_type === 'ceyrek_altin') return 'CEYREKALTIN'
  return null
}

export function debtRateSide(debt: Pick<Debt, 'direction'>): RateSide {
  return debt.direction === 'borç_aldım' ? 'selling' : 'buying'
}

// --- "Can this row be auto-valued at all?" (rate-independent) --------------

export function assetSupportsAutoValuation(asset: Pick<Asset, 'category' | 'unit' | 'currency'>): boolean {
  return assetRateSymbol(asset) !== null
}

export function debtSupportsAutoValuation(debt: Pick<Debt, 'value_type' | 'currency'>): boolean {
  return debtRateSymbol(debt) !== null
}

export function goalSupportsAutoValuation(goal: Pick<SavingsGoal, 'value_type'>): boolean {
  return goalRateSymbol(goal) !== null
}

// --- Compute the live TRY value (null when the rate is missing) ------------

export function valueAsset(
  asset: Pick<Asset, 'category' | 'unit' | 'currency' | 'amount'>,
  snapshot: MarketRatesSnapshot | null | undefined,
): number | null {
  const symbol = assetRateSymbol(asset)
  if (!symbol) return null
  return convertToTry(asset.amount, symbol, snapshot, 'buying')
}

export function valueDebt(
  debt: Pick<Debt, 'value_type' | 'currency' | 'direction' | 'amount'>,
  snapshot: MarketRatesSnapshot | null | undefined,
): number | null {
  const symbol = debtRateSymbol(debt)
  if (!symbol) return null
  return convertToTry(debt.amount, symbol, snapshot, debtRateSide(debt))
}

export function valueGoal(
  goal: Pick<SavingsGoal, 'value_type' | 'current_amount'>,
  snapshot: MarketRatesSnapshot | null | undefined,
): number | null {
  const symbol = goalRateSymbol(goal)
  if (!symbol) return null
  return convertToTry(goal.current_amount, symbol, snapshot, 'buying')
}

// --- Effective value (auto when opted-in & priced, else the stored value) --

export function effectiveAssetValue(asset: Asset, snapshot: MarketRatesSnapshot | null | undefined): number {
  if (asset.auto_valued) {
    const auto = valueAsset(asset, snapshot)
    if (auto !== null) return auto
  }
  return asset.estimated_value_try
}

export function effectiveDebtValue(debt: Debt, snapshot: MarketRatesSnapshot | null | undefined): number {
  if (debt.auto_valued) {
    const auto = valueDebt(debt, snapshot)
    if (auto !== null) return auto
  }
  return debt.estimated_value_try
}

export function effectiveGoalValue(goal: SavingsGoal, snapshot: MarketRatesSnapshot | null | undefined): number {
  if (goal.auto_valued) {
    const auto = valueGoal(goal, snapshot)
    if (auto !== null) return auto
  }
  return goal.estimated_value_try ?? 0
}
