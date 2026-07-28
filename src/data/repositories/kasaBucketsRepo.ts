import { supabase } from '../../lib/supabase'
import type { InsertFor, KasaBucket, UpdateFor } from '../../types/database'
import { appErrorFromSupabase, fail, ok, voidResultFromSupabase, type Result } from '../result'

export async function fetchKasaBuckets(): Promise<Result<KasaBucket[]>> {
  const { data, error } = await supabase
    .from('kasa_buckets')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return fail(appErrorFromSupabase(error, 'Kasa kovaları yüklenemedi.'))
  return ok((data ?? []) as KasaBucket[])
}

export async function insertKasaBucket(
  item: Omit<InsertFor<'kasa_buckets'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<KasaBucket>> {
  const { data, error } = await supabase
    .from('kasa_buckets')
    .insert(item as InsertFor<'kasa_buckets'>)
    .select()
    .single()

  if (error) return fail(appErrorFromSupabase(error, 'Kova eklenemedi.'))
  return ok(data as KasaBucket)
}

export async function updateKasaBucket(
  id: string,
  fields: UpdateFor<'kasa_buckets'>,
): Promise<Result<KasaBucket>> {
  const { data, error } = await supabase
    .from('kasa_buckets')
    .update(fields)
    .eq('id', id)
    .select()
    .single()

  if (error) return fail(appErrorFromSupabase(error, 'Kova güncellenemedi.'))
  return ok(data as KasaBucket)
}

export async function deleteKasaBucket(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('kasa_buckets').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Kova silinemedi.')
}
