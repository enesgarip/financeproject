import { fetchStockPrices } from '../lib/stockQuotesClient'
import {
  fetchAutoValuedAssets,
  fetchAutoValuedDebts,
  fetchAutoValuedGoals,
  persistEstimatedValues,
  type EstimatedValueUpdate,
} from '../data/repositories/valuationRepo'
import type { MarketRatesSnapshot } from './marketRates'
import { moneyDiffers } from './money'
import { assetIsStock, valueAsset, valueStock, valueDebt, valueGoal } from './valuation'

/**
 * Write-back: when rates refresh, recompute `estimated_value_try` for the rows
 * the user opted into automatic valuation and persist the ones that changed.
 *
 * Keeping the stored value fresh means every existing read path — dashboard net
 * worth, summaries, data-health, and server RPCs like `settle_personal_debt` —
 * stays correct without being rewired. Only auto-valued rows are touched, so
 * manual entries are never overwritten. Data access lives in
 * `data/repositories/valuationRepo`; this module is pure valuation + orchestration.
 */

export type ValuationSyncResult = {
  updated: number
  assets: number
  debts: number
  goals: number
}

function changed(next: number, current: number | null | undefined): boolean {
  return moneyDiffers(next, current ?? 0)
}

async function syncAssets(snapshot: MarketRatesSnapshot): Promise<number> {
  const result = await fetchAutoValuedAssets()
  if (!result.ok) {
    console.warn('[valuationSync] assets:', result.error.message)
    return 0
  }
  const rows = result.data
  if (rows.length === 0) return 0

  const stockRows = rows.filter(assetIsStock)
  const stockPrices = stockRows.length
    ? await fetchStockPrices(stockRows.map((asset) => asset.symbol!))
    : {}

  const updates: EstimatedValueUpdate[] = rows
    .map((asset) => ({
      id: asset.id,
      value: assetIsStock(asset) ? valueStock(asset, stockPrices) : valueAsset(asset, snapshot),
      current: asset.estimated_value_try,
    }))
    .filter((entry) => entry.value !== null && changed(entry.value, entry.current))
    .map(({ id, value }) => ({ id, value: value as number }))

  const persistResult = await persistEstimatedValues('assets', updates)
  if (!persistResult.ok) console.warn('[valuationSync] persist assets:', persistResult.error.message)
  return updates.length
}

async function syncDebts(snapshot: MarketRatesSnapshot): Promise<number> {
  const result = await fetchAutoValuedDebts()
  if (!result.ok) {
    console.warn('[valuationSync] debts:', result.error.message)
    return 0
  }
  const rows = result.data
  if (rows.length === 0) return 0

  const updates: EstimatedValueUpdate[] = rows
    .map((debt) => ({ id: debt.id, value: valueDebt(debt, snapshot), current: debt.estimated_value_try }))
    .filter((entry) => entry.value !== null && changed(entry.value, entry.current))
    .map(({ id, value }) => ({ id, value: value as number }))

  const persistResult = await persistEstimatedValues('debts', updates)
  if (!persistResult.ok) console.warn('[valuationSync] persist debts:', persistResult.error.message)
  return updates.length
}

async function syncGoals(snapshot: MarketRatesSnapshot): Promise<number> {
  const result = await fetchAutoValuedGoals()
  if (!result.ok) {
    console.warn('[valuationSync] goals:', result.error.message)
    return 0
  }
  const rows = result.data
  if (rows.length === 0) return 0

  const updates: EstimatedValueUpdate[] = rows
    .map((goal) => ({ id: goal.id, value: valueGoal(goal, snapshot), current: goal.estimated_value_try }))
    .filter((entry) => entry.value !== null && changed(entry.value, entry.current))
    .map(({ id, value }) => ({ id, value: value as number }))

  const persistResult = await persistEstimatedValues('savings_goals', updates)
  if (!persistResult.ok) console.warn('[valuationSync] persist goals:', persistResult.error.message)
  return updates.length
}

export async function syncAutoValuedRows(snapshot: MarketRatesSnapshot | null): Promise<ValuationSyncResult> {
  if (!snapshot) return { updated: 0, assets: 0, debts: 0, goals: 0 }

  const [assets, debts, goals] = await Promise.all([
    syncAssets(snapshot),
    syncDebts(snapshot),
    syncGoals(snapshot),
  ])

  return { updated: assets + debts + goals, assets, debts, goals }
}
