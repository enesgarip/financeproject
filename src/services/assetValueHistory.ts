import { supabase } from '../lib/supabase'
import type { Asset, TransactionHistory } from '../types/database'
import { formatCurrency } from '../utils/formatCurrency'
import { diffTL } from '../utils/money'

/**
 * Writes a transaction_history row when a manual asset's value changes.
 * The title summarises the old → new value; amount stores the signed delta.
 */
export async function recordAssetValueChange(
  asset: Asset,
  previousValue: number,
  newValue: number,
): Promise<void> {
  const delta = diffTL(newValue, previousValue)
  if (delta === 0) return

  const { error } = await supabase.from('transaction_history').insert({
    user_id: asset.user_id,
    occurred_at: new Date().toISOString(),
    type: 'asset' as const,
    title: `${asset.name}: ${formatCurrency(previousValue)} → ${formatCurrency(newValue)}`,
    amount: delta,
    source_table: 'assets',
    source_id: asset.id,
    note: null,
  })

  if (error) {
    // Silently log — the asset update itself has already succeeded, so we
    // don't want to break the flow for a history write failure.
    console.error('[assetValueHistory] insert failed:', error.message)
  }
}

/**
 * Fetches recent value-change history entries for a specific asset.
 */
export async function fetchAssetValueHistory(
  assetId: string,
  limit = 10,
): Promise<TransactionHistory[]> {
  const { data, error } = await supabase
    .from('transaction_history')
    .select('*')
    .eq('source_table', 'assets')
    .eq('source_id', assetId)
    .eq('type', 'asset')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[assetValueHistory] fetch failed:', error.message)
    return []
  }

  return data ?? []
}
