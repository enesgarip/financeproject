import { supabase } from '../../lib/supabase'
import type { InsertFor, RowFor, TableName, UpdateFor } from '../../types/database'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export async function fetchCrudRows<T extends TableName>(
  table: T,
  orderBy: keyof RowFor<T> & string,
  ascending: boolean,
): Promise<Result<RowFor<T>[]>> {
  const { data, error } = await supabase
    .from(table as never)
    .select('*')
    .order(orderBy, { ascending })

  return resultFromSupabase((data ?? []) as unknown as RowFor<T>[], error, 'Kayıtlar yüklenemedi.')
}

export async function deleteCrudRow<T extends TableName>(table: T, id: string): Promise<Result<void>> {
  const { error } = await supabase.from(table as never).delete().eq('id', id)
  return voidResultFromSupabase(error, 'Kayıt silinemedi.')
}

export async function saveCrudRow<T extends TableName>(
  table: T,
  payload: InsertFor<T> | UpdateFor<T>,
  editingId: string | null,
): Promise<Result<RowFor<T> | null>> {
  const response = editingId
    ? await supabase
        .from(table as never)
        .update(payload as never)
        .eq('id', editingId)
        .select()
        .single()
    : await supabase.from(table as never).insert(payload as never).select().single()

  const savedResponse = response as unknown as { data: unknown; error: Parameters<typeof resultFromSupabase>[1] }
  return resultFromSupabase(
    savedResponse.data ? (savedResponse.data as RowFor<T>) : null,
    savedResponse.error,
    'Kayıt kaydedilemedi.',
  )
}
