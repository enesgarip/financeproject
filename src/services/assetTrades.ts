import { supabase } from '../lib/supabase'
import type { Asset } from '../types/database'
import { greaterThanTL } from '../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../utils/supabaseErrors'

export type AssetTradeDirection = 'buy' | 'sell'

export type AssetTradeResult = {
  asset: Asset | null
  error: SupabaseLikeError | null
}

export function assetTradeRequiresQuantity(asset: Pick<Asset, 'category'>): boolean {
  return asset.category === 'Hisse'
}

export async function submitAssetTrade({
  assetId,
  accountId,
  direction,
  amount,
  quantity,
  note,
}: {
  assetId: string
  accountId: string
  direction: AssetTradeDirection
  amount: number
  quantity?: number | null
  note?: string | null
}): Promise<AssetTradeResult> {
  if (!greaterThanTL(amount, 0)) return { asset: null, error: { message: 'İşlem tutarı 0’dan büyük olmalı.' } }
  if (!accountId) return { asset: null, error: { message: direction === 'buy' ? 'Kaynak hesap seçmelisin.' : 'Tahsilat hesabı seçmelisin.' } }

  const { data, error } = await supabase.rpc('trade_asset_with_account', {
    p_asset_id: assetId,
    p_account_card_id: accountId,
    p_direction: direction,
    p_amount: amount,
    p_quantity: quantity ?? null,
    p_note: note ?? null,
  })

  if (error && isMissingSupabaseCapabilityError(error)) {
    return {
      asset: null,
      error: {
        ...error,
        message: missingSupabaseCapabilityMessage('Varlık al-sat altyapısı', error),
      },
    }
  }

  return { asset: data as Asset | null, error }
}
