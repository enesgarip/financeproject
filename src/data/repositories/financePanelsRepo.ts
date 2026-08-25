import { supabase } from '../../lib/supabase'
import type { AccountLedger, AccountReconciliation, CardLedger, InsertFor } from '../../types/database'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export async function fetchAccountLedgerEvents(cardId: string, limit?: number): Promise<Result<AccountLedger[]>> {
  // Limit yalnız "son N hareket" gibi özet yüzeyler için; ledger projeksiyonu
  // (bakiye/sapma hesabı) tüm geçmişi ister, o çağrılar limitsiz kalmalı.
  let query = supabase
    .from('account_ledger')
    .select('*')
    .eq('card_id', cardId)
    .order('occurred_at', { ascending: false })
  if (limit !== undefined) query = query.limit(limit)
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
  const { data, error } = await supabase
    .from('card_ledger')
    .select('*')
    .eq('card_id', cardId)
    .order('occurred_at', { ascending: false })

  return resultFromSupabase((data ?? []) as CardLedger[], error, 'Kart borç hareketleri yüklenemedi.')
}

export async function fetchCardLedgerEventsSince(cardId: string, since: string): Promise<Result<CardLedger[]>> {
  const { data, error } = await supabase
    .from('card_ledger')
    .select('*')
    .eq('card_id', cardId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })

  return resultFromSupabase((data ?? []) as CardLedger[], error, 'Kart borç hareketleri yüklenemedi.')
}

export async function fetchAccountLedgerEventsSince(cardId: string, since: string): Promise<Result<AccountLedger[]>> {
  const { data, error } = await supabase
    .from('account_ledger')
    .select('*')
    .eq('card_id', cardId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })

  return resultFromSupabase((data ?? []) as AccountLedger[], error, 'Hesap hareketleri yüklenemedi.')
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
