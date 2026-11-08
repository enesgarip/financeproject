import { supabase } from '../../lib/supabase'
import type { CrudTableName, RowFor } from '../../types/database'
import type { SupabaseLikeError } from '../../utils/supabaseErrors'

/** PK imleci: tarih eşitlikleri ve PostgREST'in 1000 satır sınırı kayıt yutmaz.
 * Hata varsa kısmi toplam döndürülmez. Sıralama tam okuma sonrasında yapılır. */
export async function readAllRows<T extends CrudTableName>(table: T, filters: { column: string; op: 'eq' | 'gte'; value: string }[] = []) {
  const rows: RowFor<T>[] = []
  let before: string | null = null
  for (;;) {
    let query = supabase.from(table as never).select('*').order('id', { ascending: false }).limit(500)
    for (const filter of filters) query = query[filter.op](filter.column, filter.value)
    if (before) query = query.lt('id', before)
    const { data, error } = await query
    if (error) return { data: null, error: error as SupabaseLikeError }
    const page = (data ?? []) as unknown as RowFor<T>[]
    rows.push(...page)
    if (page.length < 500) return { data: rows, error: null }
    const next = (page.at(-1) as { id: string } | undefined)?.id
    if (!next || (before && next >= before)) return { data: null, error: { message: 'Verinin devamı doğrulanamadı.' } as SupabaseLikeError }
    before = next
  }
}

export function sortRowsBy<T>(rows: T[], key: keyof T, ascending = false): T[] {
  return rows.sort((a, b) => ((typeof a[key] === 'number' && typeof b[key] === 'number' ? Number(a[key]) - Number(b[key]) : String(a[key] ?? '').localeCompare(String(b[key] ?? ''))) || String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id))) * (ascending ? 1 : -1))
}
