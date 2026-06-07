import { supabase } from '../lib/supabase'
import { fetchStockPrices } from '../lib/stockQuotesClient'
import type { Asset, Debt, SavingsGoal } from '../types/database'
import type { MarketRatesSnapshot } from './marketRates'
import { assetIsStock, valueAsset, valueStock, valueDebt, valueGoal } from './valuation'

/**
 * Write-back: when rates refresh, recompute `estimated_value_try` for the rows
 * the user opted into automatic valuation and persist the ones that changed.
 *
 * Keeping the stored value fresh means every existing read path — dashboard net
 * worth, summaries, data-health, and server RPCs like `settle_personal_debt` —
 * stays correct without being rewired. Only auto-valued rows are touched, so
 * manual entries are never overwritten. RLS scopes all queries to the signed-in
 * user, so no explicit user filter is needed.
 */

const TOLERANCE = 0.01

export type ValuationSyncResult = {
  updated: number
  assets: number
  debts: number
  goals: number
}

function changed(next: number, current: number | null | undefined): boolean {
  return Math.abs(next - (current ?? 0)) > TOLERANCE
}

async function syncAssets(snapshot: MarketRatesSnapshot): Promise<number> {
  const { data, error } = await supabase.from('assets').select('*').eq('auto_valued', true)
  if (error || !data) return 0

  const rows = data as Asset[]

  // Stocks are priced via the bist-quote edge function (one batched call).
  const stockRows = rows.filter(assetIsStock)
  const stockPrices = stockRows.length
    ? await fetchStockPrices(stockRows.map((asset) => asset.symbol!))
    : {}

  const updates = rows
    .map((asset) => ({
      asset,
      value: assetIsStock(asset) ? valueStock(asset, stockPrices) : valueAsset(asset, snapshot),
    }))
    .filter((entry): entry is { asset: Asset; value: number } => entry.value !== null && changed(entry.value, entry.asset.estimated_value_try))

  await Promise.all(
    updates.map(({ asset, value }) =>
      supabase
        .from('assets')
        .update({ estimated_value_try: value, updated_at: new Date().toISOString() })
        .eq('id', asset.id),
    ),
  )
  return updates.length
}

async function syncDebts(snapshot: MarketRatesSnapshot): Promise<number> {
  const { data, error } = await supabase.from('debts').select('*').eq('auto_valued', true).eq('status', 'açık')
  if (error || !data) return 0

  const updates = (data as Debt[])
    .map((debt) => ({ debt, value: valueDebt(debt, snapshot) }))
    .filter((entry): entry is { debt: Debt; value: number } => entry.value !== null && changed(entry.value, entry.debt.estimated_value_try))

  await Promise.all(
    updates.map(({ debt, value }) =>
      supabase
        .from('debts')
        .update({ estimated_value_try: value, updated_at: new Date().toISOString() })
        .eq('id', debt.id),
    ),
  )
  return updates.length
}

async function syncGoals(snapshot: MarketRatesSnapshot): Promise<number> {
  const { data, error } = await supabase.from('savings_goals').select('*').eq('auto_valued', true).eq('status', 'active')
  if (error || !data) return 0

  const updates = (data as SavingsGoal[])
    .map((goal) => ({ goal, value: valueGoal(goal, snapshot) }))
    .filter((entry): entry is { goal: SavingsGoal; value: number } => entry.value !== null && changed(entry.value, entry.goal.estimated_value_try))

  await Promise.all(
    updates.map(({ goal, value }) =>
      supabase
        .from('savings_goals')
        .update({ estimated_value_try: value, updated_at: new Date().toISOString() })
        .eq('id', goal.id),
    ),
  )
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
