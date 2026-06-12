import { supabase } from '../../lib/supabase'
import type { Asset, InsertFor, UpdateFor } from '../../types/database'
import { GOLD_LEDGER_SOURCE } from '../../utils/goldLedger'

/**
 * Altın defteri tarafından yönetilen `assets` satırlarının veri erişimi.
 * Projeksiyon/karşılaştırma mantığı `utils/goldLedgerSync.ts`'te kalır.
 */

export async function fetchGoldLedgerAssets(userId: string): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .eq('source', GOLD_LEDGER_SOURCE)

  if (error) throw error
  return (data ?? []) as Asset[]
}

export async function insertGoldLedgerAsset(payload: InsertFor<'assets'>): Promise<void> {
  const { error } = await supabase.from('assets').insert(payload as never)
  if (error) throw error
}

export async function updateGoldLedgerAsset(id: string, payload: UpdateFor<'assets'>): Promise<void> {
  const { error } = await supabase.from('assets').update(payload as never).eq('id', id)
  if (error) throw error
}

export async function deleteGoldLedgerAsset(id: string): Promise<void> {
  const { error } = await supabase.from('assets').delete().eq('id', id)
  if (error) throw error
}
