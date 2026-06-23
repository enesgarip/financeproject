import { supabase } from '../../lib/supabase'
import type { CardAlias } from '../../types/database'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export async function fetchCardAliases(cardId: string): Promise<Result<CardAlias[]>> {
  const { data, error } = await supabase
    .from('card_aliases')
    .select('*')
    .eq('card_id', cardId)
    .order('created_at', { ascending: true })

  return resultFromSupabase((data ?? []) as CardAlias[], error, 'Kart takma adları yüklenemedi.')
}

export async function addCardAlias(input: {
  userId: string
  cardId: string
  lastFourDigits: string
  label: string | null
}): Promise<Result<void>> {
  const { error } = await supabase.from('card_aliases').insert({
    user_id: input.userId,
    card_id: input.cardId,
    last_four_digits: input.lastFourDigits,
    label: input.label,
  })

  return voidResultFromSupabase(error, 'Kart numarası eklenemedi.')
}

export async function deleteCardAlias(aliasId: string): Promise<Result<void>> {
  const { error } = await supabase.from('card_aliases').delete().eq('id', aliasId)

  return voidResultFromSupabase(error, 'Kart numarası silinemedi.')
}
