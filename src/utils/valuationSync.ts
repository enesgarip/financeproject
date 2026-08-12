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
import {
  assetIsStock,
  assetUnitRate,
  debtUnitRate,
  goalUnitRate,
  valueAsset,
  valueStock,
  valueDebt,
  valueGoal,
} from './valuation'

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
  /** GERÇEKTEN yazılan satır sayısı (denenen değil). */
  updated: number
  assets: number
  debts: number
  goals: number
  /** Yazılamayan satır sayısı; > 0 ise gösterilen değer bayat kalmış olabilir. */
  failed: number
}

/** Tek tablonun yazma sonucu: denenen değil, yazılan sayılır. */
type TableSyncOutcome = { updated: number; failed: number }

const NO_CHANGES: TableSyncOutcome = { updated: 0, failed: 0 }

function changed(next: number, current: number | null | undefined): boolean {
  return moneyDiffers(next, current ?? 0)
}

/**
 * `persistEstimatedValues` sonucunu sayıya indirger.
 *
 * Bulgu (Faz F): eskiden `updates.length` dönülüyordu, yani hata hâlinde bile
 * "N güncellendi" deniyordu — RatesBanner buna bakıp cache'i tazeliyor,
 * kullanıcı ise yazılmamış değeri güncel sanıyordu. Repo artık
 * `{requested, updated, failed}` döndürüyor; gerçek sayı ondan okunur.
 */
function outcomeOf(
  label: string,
  requested: number,
  result: Awaited<ReturnType<typeof persistEstimatedValues>>,
): TableSyncOutcome {
  if (!result.ok) {
    console.warn(`[valuationSync] persist ${label}:`, result.error.message)
    return { updated: 0, failed: requested }
  }
  const { updated, failed } = result.data
  if (failed.length > 0) {
    console.warn(
      `[valuationSync] persist ${label}: ${failed.length}/${requested} satır yazılamadı —`,
      failed.map((row) => `${row.id}: ${row.message}`).join(' | '),
    )
  }
  return { updated, failed: failed.length }
}

async function syncAssets(snapshot: MarketRatesSnapshot): Promise<TableSyncOutcome> {
  const result = await fetchAutoValuedAssets()
  if (!result.ok) {
    console.warn('[valuationSync] assets:', result.error.message)
    return NO_CHANGES
  }
  const rows = result.data
  if (rows.length === 0) return NO_CHANGES

  const stockRows = rows.filter(assetIsStock)
  // `fetchStockPrices` çok bayat cache'i (bkz. STOCK_PRICES_MAX_AGE_HOURS)
  // döndürmez: fiyatı olmayan hisse `valueStock` içinde null olur, satır
  // filtrelenir ve saklanan değer korunur. Böylece bayat fiyat SESSİZCE
  // `estimated_value_try`'a yazılıp taze görünmez.
  const stockPrices = stockRows.length
    ? await fetchStockPrices(stockRows.map((asset) => asset.symbol!))
    : {}

  const updates: EstimatedValueUpdate[] = rows
    .map((asset) => ({
      id: asset.id,
      value: assetIsStock(asset) ? valueStock(asset, stockPrices) : valueAsset(asset, snapshot),
      rate: assetUnitRate(asset, snapshot, stockPrices),
      current: asset.estimated_value_try,
    }))
    .filter((entry) => entry.value !== null && changed(entry.value, entry.current))
    .map(({ id, value, rate }) => ({ id, value: value as number, rate }))

  return outcomeOf('assets', updates.length, await persistEstimatedValues('assets', updates))
}

async function syncDebts(snapshot: MarketRatesSnapshot): Promise<TableSyncOutcome> {
  const result = await fetchAutoValuedDebts()
  if (!result.ok) {
    console.warn('[valuationSync] debts:', result.error.message)
    return NO_CHANGES
  }
  const rows = result.data
  if (rows.length === 0) return NO_CHANGES

  const updates: EstimatedValueUpdate[] = rows
    .map((debt) => ({
      id: debt.id,
      value: valueDebt(debt, snapshot),
      rate: debtUnitRate(debt, snapshot),
      current: debt.estimated_value_try,
    }))
    .filter((entry) => entry.value !== null && changed(entry.value, entry.current))
    .map(({ id, value, rate }) => ({ id, value: value as number, rate }))

  return outcomeOf('debts', updates.length, await persistEstimatedValues('debts', updates))
}

async function syncGoals(snapshot: MarketRatesSnapshot): Promise<TableSyncOutcome> {
  const result = await fetchAutoValuedGoals()
  if (!result.ok) {
    console.warn('[valuationSync] goals:', result.error.message)
    return NO_CHANGES
  }
  const rows = result.data
  if (rows.length === 0) return NO_CHANGES

  const updates: EstimatedValueUpdate[] = rows
    .map((goal) => ({
      id: goal.id,
      value: valueGoal(goal, snapshot),
      rate: goalUnitRate(goal, snapshot),
      current: goal.estimated_value_try,
    }))
    .filter((entry) => entry.value !== null && changed(entry.value, entry.current))
    .map(({ id, value, rate }) => ({ id, value: value as number, rate }))

  return outcomeOf('goals', updates.length, await persistEstimatedValues('savings_goals', updates))
}

export async function syncAutoValuedRows(snapshot: MarketRatesSnapshot | null): Promise<ValuationSyncResult> {
  if (!snapshot) return { updated: 0, assets: 0, debts: 0, goals: 0, failed: 0 }

  const [assets, debts, goals] = await Promise.all([
    syncAssets(snapshot),
    syncDebts(snapshot),
    syncGoals(snapshot),
  ])

  return {
    updated: assets.updated + debts.updated + goals.updated,
    assets: assets.updated,
    debts: debts.updated,
    goals: goals.updated,
    failed: assets.failed + debts.failed + goals.failed,
  }
}
