import { supabase } from '../../lib/supabase'
import type { InsertFor } from '../../types/database'

/** Toplu planlı ödeme ekleme (Türkiye takvim preset'leri — roadmap Y4). */
export async function insertPayments(rows: InsertFor<'payments'>[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('payments').insert(rows as never)
  if (error) throw error
}
