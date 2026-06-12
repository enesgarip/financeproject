import { supabase } from '../../lib/supabase'

/** (description → category) öğrenme hafızasının ham kaynağı: son kart harcamaları. */

export type CategoryMemoryRow = { description: string | null; category: string | null }

export async function fetchCategoryMemoryRows(): Promise<CategoryMemoryRow[]> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('description, category, spent_at')
    .order('spent_at', { ascending: false })
    .limit(400)

  if (error) return []
  return (data ?? []) as CategoryMemoryRow[]
}
