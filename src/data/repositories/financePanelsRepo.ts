import { supabase } from '../../lib/supabase'
import type { AccountLedger, AccountReconciliation, CardLedger, InsertFor } from '../../types/database'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

const LEDGER_PAGE_SIZE = 500

/** PostgREST'in varsayılan 1000 satır sınırı projeksiyonu eksik bırakamaz. */
async function fetchLedgerHistory<T extends { id: string; occurred_at: string }>(
  table: 'card_ledger' | 'account_ledger', cardId: string, since?: string,
): Promise<Result<T[]>> {
  const rows: T[] = []
  let beforeId: string | null = null
  for (;;) {
    let query = supabase.from(table).select('*').eq('card_id', cardId).order('id', { ascending: false })
    if (since !== undefined) query = query.gte('occurred_at', since)
    if (beforeId !== null) query = query.lt('id', beforeId)
    const { data, error } = await query.limit(LEDGER_PAGE_SIZE)
    // Kısmi sonuçtan fark/ters kayıt önerilmez; herhangi bir sayfa hatası tüm okumayı başarısız kılar.
    if (error) return resultFromSupabase<T[]>([], error, 'Hareket geçmişi tamamen yüklenemedi.')
    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < LEDGER_PAGE_SIZE) {
      rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id))
      return resultFromSupabase(rows, null)
    }
    const nextId = page.at(-1)?.id
    if (!nextId || (beforeId !== null && nextId >= beforeId)) {
      return resultFromSupabase<T[]>([], { message: 'Hareket geçmişinin devamı doğrulanamadı.' })
    }
    beforeId = nextId
  }
}

export async function fetchAccountLedgerEvents(cardId: string, limit?: number): Promise<Result<AccountLedger[]>> {
  // Limit yalnız "son N hareket" gibi özet yüzeyler için; ledger projeksiyonu
  // (bakiye/sapma hesabı) tüm geçmişi ister, o çağrılar limitsiz kalmalı.
  if (limit === undefined) return fetchLedgerHistory<AccountLedger>('account_ledger', cardId)
  const query = supabase
    .from('account_ledger')
    .select('*')
    .eq('card_id', cardId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  const { data, error } = await query

  return resultFromSupabase((data ?? []) as AccountLedger[], error, 'Hesap hareketleri yüklenemedi.')
}

/**
 * Maaş yatışı/değişikliği tespiti için: verilen tarihten beri TÜM hesapların
 * hareketleri. Çıkışlar da gelir — transfer bacağı eleme (utils/salaryDeposit
 * `findSalaryChangeCandidate`) aynı gün eşit tutarlı çıkışı arar.
 */
export async function fetchAccountEventsSince(since: string): Promise<Result<AccountLedger[]>> {
  const { data, error } = await supabase
    .from('account_ledger')
    .select('*')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(200)

  return resultFromSupabase((data ?? []) as AccountLedger[], error, 'Hesap hareketleri yüklenemedi.')
}

export async function fetchCardLedgerEvents(cardId: string): Promise<Result<CardLedger[]>> {
  return fetchLedgerHistory<CardLedger>('card_ledger', cardId)
}

export async function fetchCardLedgerEventsSince(cardId: string, since: string): Promise<Result<CardLedger[]>> {
  return fetchLedgerHistory<CardLedger>('card_ledger', cardId, since)
}

export async function fetchAccountLedgerEventsSince(cardId: string, since: string): Promise<Result<AccountLedger[]>> {
  return fetchLedgerHistory<AccountLedger>('account_ledger', cardId, since)
}

export async function fetchRecentCardLedgerEvents(limit = 100): Promise<Result<CardLedger[]>> {
  const { data, error } = await supabase
    .from('card_ledger')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as CardLedger[], error, 'Kart borç hareketleri yüklenemedi.')
}

export async function fetchRecentAccountLedgerEvents(limit = 100): Promise<Result<AccountLedger[]>> {
  const { data, error } = await supabase
    .from('account_ledger')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as AccountLedger[], error, 'Hesap hareketleri yüklenemedi.')
}

export async function fetchAccountReconciliations(): Promise<Result<AccountReconciliation[]>> {
  const { data, error } = await supabase
    .from('account_reconciliations')
    .select('*')
    .order('reconciled_at', { ascending: false })

  return resultFromSupabase((data ?? []) as AccountReconciliation[], error, 'Mutabakat kayıtları yüklenemedi.')
}

export async function insertAccountReconciliation(
  payload: InsertFor<'account_reconciliations'>,
): Promise<Result<void>> {
  const { error } = await supabase.from('account_reconciliations').insert(payload)
  return voidResultFromSupabase(error, 'Mutabakat kaydedilemedi.')
}
