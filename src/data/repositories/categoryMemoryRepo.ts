import { supabase } from '../../lib/supabase'
import { resultFromSupabase, type Result } from '../result'

/** (description → category) öğrenme hafızasının ham kaynağı: son kart harcamaları. */

export type CategoryMemoryRow = { description: string | null; category: string | null }

export async function fetchCategoryMemoryRows(): Promise<Result<CategoryMemoryRow[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('description, category, spent_at')
    .order('spent_at', { ascending: false })
    .limit(400)

  return resultFromSupabase((data ?? []) as CategoryMemoryRow[], error, 'Kategori hafızası yüklenemedi.')
}
