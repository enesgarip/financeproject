import { supabase } from '../../lib/supabase'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'

/**
 * Tam yedek/geri yükleme için ham tablo I/O'su. Yedek şeması, FK sırası,
 * parse ve yığınlama mantığı `utils/backup.ts`'te (saf + test edilir) kalır.
 */

export type BackupRow = Record<string, unknown>

/** Tablo henüz deploy edilmemişse (missing-capability) null döner; çağıran atlar. */
export async function fetchTableRows(table: string): Promise<BackupRow[] | null> {
  const { data, error } = await supabase.from(table as 'cards').select('*')
  if (error) {
    if (isMissingSupabaseCapabilityError(error)) return null
    throw new Error(`${table} okunamadı: ${error.message}`)
  }
  return (data ?? []) as BackupRow[]
}

export async function deleteOwnRows(table: string, userId: string): Promise<void> {
  const { error } = await supabase.from(table as 'cards').delete().eq('user_id', userId)
  if (error && !isMissingSupabaseCapabilityError(error)) {
    throw new Error(`${table} temizlenemedi: ${error.message}`)
  }
}

/** Tablo deploy edilmemişse false döner; çağıran o tablonun kalan satırlarını atlar. */
export async function insertRows(table: string, rows: BackupRow[]): Promise<boolean> {
  const { error } = await supabase.from(table as 'cards').insert(rows as never)
  if (error) {
    if (isMissingSupabaseCapabilityError(error)) return false
    throw new Error(`${table} geri yüklenemedi: ${error.message}`)
  }
  return true
}
