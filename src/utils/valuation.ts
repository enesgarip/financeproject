import type { Asset, Debt, SavingsGoal } from '../types/database'
import { convertToTry, unitRate, type MarketRatesSnapshot, type RateSide, type RateSymbol } from './marketRates'
import { roundTL as round2 } from './money'

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

/** Live BIST equity prices keyed by ticker (without .IS), in TRY. */
export type StockPrices = Record<string, number>

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

// --- Stocks (BIST equities, priced via the bist-quote edge function) -------

/** A row is a stock holding when it's category 'Hisse' with a ticker symbol. */
export function assetIsStock(asset: Pick<Asset, 'category' | 'symbol'>): boolean {
  return asset.category === 'Hisse' && Boolean(asset.symbol)
}

/** Live TRY value of a stock holding = price × quantity. Null when unpriced. */
export function valueStock(
  asset: Pick<Asset, 'category' | 'symbol' | 'amount'>,
  prices: StockPrices | null | undefined,
): number | null {
  if (!assetIsStock(asset) || !prices) return null
  const price = prices[asset.symbol!.toUpperCase()]
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  return round2(price * asset.amount)
}

/** Total purchase cost of a stock holding = unit cost × quantity. */
export function stockCostBasis(asset: Pick<Asset, 'unit_cost' | 'amount'>): number | null {
  if (asset.unit_cost == null || !Number.isFinite(asset.unit_cost)) return null
  return round2(asset.unit_cost * asset.amount)
}

/** Profit/loss of a stock holding given its current value, in TRY and percent. */
export function stockProfit(
  currentValue: number,
  asset: Pick<Asset, 'unit_cost' | 'amount'>,
): { profit: number; profitPct: number; cost: number } | null {
  const cost = stockCostBasis(asset)
  if (cost === null) return null
  const profit = round2(currentValue - cost)
  const profitPct = cost > 0 ? round2((profit / cost) * 100) : 0
  return { profit, profitPct, cost }
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

// --- Birim kur (değerlemeyle birlikte saklanır — Faz D3) --------------------

export function assetUnitRate(
  asset: Pick<Asset, 'category' | 'unit' | 'currency' | 'symbol' | 'amount'>,
  snapshot: MarketRatesSnapshot | null | undefined,
  stockPrices?: StockPrices | null,
): number | null {
  if (assetIsStock(asset)) {
    const price = stockPrices?.[asset.symbol!.toUpperCase()]
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
  }
  const symbol = assetRateSymbol(asset)
  return symbol ? unitRate(symbol, snapshot, 'buying') : null
}

export function debtUnitRate(
  debt: Pick<Debt, 'value_type' | 'currency' | 'direction'>,
  snapshot: MarketRatesSnapshot | null | undefined,
): number | null {
  const symbol = debtRateSymbol(debt)
  return symbol ? unitRate(symbol, snapshot, debtRateSide(debt)) : null
}

export function goalUnitRate(
  goal: Pick<SavingsGoal, 'value_type'>,
  snapshot: MarketRatesSnapshot | null | undefined,
): number | null {
  const symbol = goalRateSymbol(goal)
  return symbol ? unitRate(symbol, snapshot, 'buying') : null
}

// --- Effective value (auto when opted-in & priced, else the stored value) --

/**
 * Gösterilen rakamın NEREDEN geldiği (Faz D3):
 *  - live   : canlı kurla şimdi hesaplandı
 *  - stored : otomatik değerleme açık ama kur alınamadı → en son saklanan değer
 *  - manual : kullanıcının elle girdiği değer
 *
 * `stored` sessiz kaldığı sürece kullanıcı bayat bir rakamı canlı sanıyordu;
 * ayrım rozetle görünür kılınabilsin diye dışarı veriliyor.
 */
export type ValueSource = 'live' | 'stored' | 'manual'

export function effectiveAssetValueWithSource(
  asset: Asset,
  snapshot: MarketRatesSnapshot | null | undefined,
  stockPrices?: StockPrices | null,
): { value: number; source: ValueSource } {
  if (asset.auto_valued) {
    const auto = assetIsStock(asset) ? valueStock(asset, stockPrices) : valueAsset(asset, snapshot)
    if (auto !== null) return { value: auto, source: 'live' }
    return { value: asset.estimated_value_try, source: 'stored' }
  }
  return { value: asset.estimated_value_try, source: 'manual' }
}

export function effectiveAssetValue(
  asset: Asset,
  snapshot: MarketRatesSnapshot | null | undefined,
  stockPrices?: StockPrices | null,
): number {
  return effectiveAssetValueWithSource(asset, snapshot, stockPrices).value
}

export function effectiveDebtValueWithSource(
  debt: Debt,
  snapshot: MarketRatesSnapshot | null | undefined,
): { value: number; source: ValueSource } {
  if (debt.auto_valued) {
    const auto = valueDebt(debt, snapshot)
    if (auto !== null) return { value: auto, source: 'live' }
    return { value: debt.estimated_value_try, source: 'stored' }
  }
  return { value: debt.estimated_value_try, source: 'manual' }
}

export function effectiveDebtValue(debt: Debt, snapshot: MarketRatesSnapshot | null | undefined): number {
  return effectiveDebtValueWithSource(debt, snapshot).value
}

export function effectiveGoalValueWithSource(
  goal: SavingsGoal,
  snapshot: MarketRatesSnapshot | null | undefined,
): { value: number; source: ValueSource } {
  if (goal.auto_valued) {
    const auto = valueGoal(goal, snapshot)
    if (auto !== null) return { value: auto, source: 'live' }
    return { value: goal.estimated_value_try ?? 0, source: 'stored' }
  }
  return { value: goal.estimated_value_try ?? 0, source: 'manual' }
}

export function effectiveGoalValue(goal: SavingsGoal, snapshot: MarketRatesSnapshot | null | undefined): number {
  return effectiveGoalValueWithSource(goal, snapshot).value
}
