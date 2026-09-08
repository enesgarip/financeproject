import { supabase } from '../lib/supabase'
import type { Asset } from '../types/database'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../utils/supabaseErrors'

/**
 * Manuel varlık değer güncellemesi: değer + o dönemde yatırılan katkı + tarih
 * + not, tek transaction'da (`update_asset_value`). Olay `asset_value_events`'e,
 * akış satırı `transaction_history`'ye sunucuda yazılır — eski "önce satırı
 * güncelle, sonra client'tan işaretli delta ekle" yolu düşüşleri kaybediyordu.
 */
export type AssetValueUpdateResult = {
  asset: Asset | null
  error: SupabaseLikeError | null
}

export async function updateAssetValue({
  assetId,
  value,
  contribution,
  occurredAt,
  note,
}: {
  assetId: string
  value: number
  contribution?: number | null
  occurredAt?: string | null
  note?: string | null
}): Promise<AssetValueUpdateResult> {
  if (!Number.isFinite(value) || value < 0) return { asset: null, error: { message: 'Değer 0 veya daha büyük olmalı.' } }

  const { data, error } = await supabase.rpc('update_asset_value', {
    p_asset_id: assetId,
    p_value: value,
    p_contribution: contribution ?? 0,
    p_occurred_at: occurredAt ?? new Date().toISOString(),
    p_note: note ?? null,
  })

  if (error && isMissingSupabaseCapabilityError(error)) {
    return {
      asset: null,
      error: { ...error, message: missingSupabaseCapabilityMessage('Varlık değer geçmişi altyapısı', error) },
    }
  }

  return { asset: data as Asset | null, error }
}
