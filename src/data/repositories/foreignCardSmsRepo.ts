import { supabase } from '../../lib/supabase'
import type { CardAlias, ForeignCardSms, SmsLog } from '../../types/database'
import { normalizeSmsWhitespace, parseSms } from '../../utils/smsParser'
import { sha256Hex } from '../../utils/sourceEventId'
import { inferExpenseCategory } from '../../utils/categories'
import { appErrorFromSupabase, fail, ok, voidResultFromSupabase, type Result } from '../result'

async function readRows(table: 'foreign_card_sms' | 'sms_log' | 'card_aliases'): Promise<Result<unknown[]>> {
  const rows: unknown[] = []
  let cursor: string | null = null
  for (;;) {
    let query = (table === 'sms_log' ? supabase.from('sms_log').select('*').eq('status', 'error')
      : table === 'foreign_card_sms' ? supabase.from('foreign_card_sms').select('*').is('completed_at', null)
      : supabase.from('card_aliases').select('*')).order('id', { ascending: false }).limit(500)
    if (cursor) query = query.lt('id', cursor)
    const response = await query
    if (response.error) return fail(appErrorFromSupabase(response.error, 'Dövizli SMS kayıtları yüklenemedi.'))
    const page: Array<{ id: string }> = response.data
    rows.push(...page)
    if (page.length < 500) return ok(rows)
    cursor = page[page.length - 1].id
  }
}

/** Eski hata günlüğünden yalnız tekil kartı çözülen döviz SMS'lerini kurtarır. Finansal etkisi yoktur. */
export async function fetchForeignCardSms(userId: string): Promise<Result<{ rows: ForeignCardSms[]; recoveryWarning: string | null }>> {
  const logs = await readRows('sms_log')
  let recoveryWarning: string | null = null
  if (!logs.ok) recoveryWarning = 'Eski SMS kayıtları taranamadı. Yenileyerek tekrar deneyebilirsin.'
  else {
    const seen = new Set<string>()
    const candidates = (logs.data as SmsLog[]).flatMap(log => {
      const parsed = parseSms(log.raw_sms)
      const normalized = normalizeSmsWhitespace(log.raw_sms)
      if (seen.has(normalized)) return []
      seen.add(normalized)
      return parsed?.type === 'card' && parsed.currency ? [{ parsed, raw: log.raw_sms }] : []
    })
    if (candidates.length) {
      const aliases = await readRows('card_aliases')
      if (!aliases.ok) recoveryWarning = 'Eski dövizli SMS’lerin kart eşleşmeleri yüklenemedi.'
      else for (const { parsed, raw } of candidates) {
        const cards = [...new Set((aliases.data as CardAlias[]).flatMap(alias => alias.last_four_digits === parsed.lastFour && alias.card_id ? [alias.card_id] : []))]
        if (cards.length !== 1) { recoveryWarning = 'Bazı eski dövizli SMS’lerin kartı eşleşmedi. Kart takma adlarını kontrol et.'; continue }
        const { error } = await supabase.rpc('queue_foreign_card_sms', {
          p_user_id: userId, p_card_id: cards[0], p_native_amount: parsed.amount, p_currency: parsed.currency!,
          p_description: parsed.merchant, p_spent_at: parsed.spentAt, p_category: inferExpenseCategory(parsed.merchant) ?? 'Diğer',
          p_source_event_id: await sha256Hex(normalizeSmsWhitespace(raw)), p_raw_sms: raw,
        })
        if (error) recoveryWarning = 'Bazı eski dövizli SMS’ler bekleme listesine alınamadı. Yenileyerek tekrar deneyebilirsin.'
      }
    }
  }
  const pending = await readRows('foreign_card_sms')
  if (!pending.ok) return pending
  return ok({ rows: (pending.data as ForeignCardSms[]).toSorted((a, b) => b.spent_at.localeCompare(a.spent_at)), recoveryWarning })
}

export async function completeForeignCardSms(id: string, amountTl: number): Promise<Result<void>> {
  const { error } = await supabase.rpc('complete_foreign_card_sms', { p_id: id, p_amount_tl: amountTl })
  return voidResultFromSupabase(error, 'Dövizli SMS tamamlanamadı. Aynı TL tutarıyla tekrar deneyebilirsin.')
}
