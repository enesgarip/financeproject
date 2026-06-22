import { supabase } from '../../lib/supabase'
import type { Asset, InsertFor, UpdateFor } from '../../types/database'
import { GOLD_LEDGER_SOURCE } from '../../utils/goldLedger'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

/**
 * Altın defteri tarafından yönetilen `assets` satırlarının veri erişimi.
 * Projeksiyon/karşılaştırma mantığı `utils/goldLedgerSync.ts`'te kalır.
 */

export async function fetchGoldLedgerAssets(userId: string): Promise<Result<Asset[]>> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .eq('source', GOLD_LEDGER_SOURCE)

  return resultFromSupabase((data ?? []) as Asset[], error, 'Altın varlıkları yüklenemedi.')
}

export async function insertGoldLedgerAsset(payload: InsertFor<'assets'>): Promise<Result<void>> {
  const { error } = await supabase.from('assets').insert(payload as never)
  return voidResultFromSupabase(error, 'Altın varlığı eklenemedi.')
}

export async function updateGoldLedgerAsset(id: string, payload: UpdateFor<'assets'>): Promise<Result<void>> {
  const { error } = await supabase.from('assets').update(payload as never).eq('id', id)
  return voidResultFromSupabase(error, 'Altın varlığı güncellenemedi.')
}

export async function deleteGoldLedgerAsset(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('assets').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Altın varlığı silinemedi.')
}
