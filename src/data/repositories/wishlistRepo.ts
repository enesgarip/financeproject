import { supabase } from '../../lib/supabase'
import type { InsertFor, UpdateFor, WishlistItem } from '../../types/database'
import { appErrorFromSupabase, fail, ok, voidResultFromSupabase, type Result } from '../result'

export async function fetchWishlistItems(): Promise<Result<WishlistItem[]>> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('*')
    .order('is_purchased', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) return fail(appErrorFromSupabase(error, 'Liste yüklenemedi.'))
  return ok((data ?? []) as WishlistItem[])
}

export async function insertWishlistItem(
  item: Omit<InsertFor<'wishlist_items'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<WishlistItem>> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .insert(item as InsertFor<'wishlist_items'>)
    .select()
    .single()

  if (error) return fail(appErrorFromSupabase(error, 'Madde eklenemedi.'))
  return ok(data as WishlistItem)
}

export async function updateWishlistItem(
  id: string,
  fields: UpdateFor<'wishlist_items'>,
): Promise<Result<WishlistItem>> {
  const { data, error } = await supabase
    .from('wishlist_items')
    .update(fields)
    .eq('id', id)
    .select()
    .single()

  if (error) return fail(appErrorFromSupabase(error, 'Madde güncellenemedi.'))
  return ok(data as WishlistItem)
}

export async function deleteWishlistItem(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('wishlist_items').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Madde silinemedi.')
}
