import { supabase } from '../../lib/supabase'
import type { InsertFor } from '../../types/database'
import { ok, voidResultFromSupabase, type Result } from '../result'

/** Toplu planlı ödeme ekleme (Türkiye takvim preset'leri — roadmap Y4). */
export async function insertPayments(rows: InsertFor<'payments'>[]): Promise<Result<void>> {
  if (rows.length === 0) return ok(undefined)
  const { error } = await supabase.from('payments').insert(rows as never)
  return voidResultFromSupabase(error, 'Ödemeler eklenemedi.')
}
