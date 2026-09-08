import { supabase } from '../../lib/supabase'
import type { AssetValueEvent } from '../../types/database'
import { resultFromSupabase, type Result } from '../result'

/** Manuel varlığın değer olayları (en yeni önce). Özet tüm geçmişi ister; limit yok. */
export async function fetchAssetValueEvents(assetId: string): Promise<Result<AssetValueEvent[]>> {
  const { data, error } = await supabase
    .from('asset_value_events')
    .select('*')
    .eq('asset_id', assetId)
    .order('occurred_at', { ascending: false })

  return resultFromSupabase((data ?? []) as AssetValueEvent[], error, 'Değer geçmişi yüklenemedi.')
}
