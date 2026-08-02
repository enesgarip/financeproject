import { supabase } from '../../lib/supabase'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'

/**
 * Tam yedek/geri yükleme için ham tablo I/O'su. Yedek şeması, FK sırası,
 * parse ve yığınlama mantığı `utils/backup.ts`'te (saf + test edilir) kalır.
 */

export type BackupRow = Record<string, unknown>

const PAGE_SIZE = 500

/** Tablo henüz deploy edilmemişse (missing-capability) null döner; çağıran atlar. */
export async function fetchTableRows(table: string): Promise<BackupRow[] | null> {
  const rows: BackupRow[] = []
  const orderColumn = table === 'notification_preferences' ? 'user_id' : 'id'
  let beforeKey: string | null = null

  // Descending keyset pagination makes the first page's immutable PK the
  // practical upper bound. Requests are not one transaction snapshot, so
  // concurrent inserts/deletes may change membership; immutable cursors
  // prevent offset boundary shifts among rows that remain visible.
  for (;;) {
    let query = supabase
      .from(table as 'cards')
      .select('*')
      .order(orderColumn, { ascending: false })

    if (beforeKey !== null) query = query.lt(orderColumn, beforeKey)
    const { data, error } = await query.limit(PAGE_SIZE)

    if (error) {
      if (isMissingSupabaseCapabilityError(error)) return null
      throw new Error(`${table} okunamadı: ${error.message}`)
    }

    const page = (data ?? []) as unknown as BackupRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows.reverse()

    const nextBeforeKey = page.at(-1)?.[orderColumn]
    if (typeof nextBeforeKey !== 'string') {
      throw new Error(`${table} okunamadı: ${orderColumn} sayfalama anahtarı bulunamadı.`)
    }
    beforeKey = nextBeforeKey
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

/** Restores use the transactional, FK-safe reset path before replaying rows. */
export async function resetOwnFinanceData(): Promise<void> {
  const { error } = await supabase.rpc('reset_user_finance_data', {})
  if (error) throw new Error(`Mevcut veriler temizlenemedi: ${error.message}`)
}
