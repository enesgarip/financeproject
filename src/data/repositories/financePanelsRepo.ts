import { supabase } from '../../lib/supabase'
import type { AccountLedger, AccountReconciliation, CardLedger, InsertFor } from '../../types/database'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export async function fetchAccountLedgerEvents(cardId: string): Promise<Result<AccountLedger[]>> {
  const { data, error } = await supabase
    .from('account_ledger')
    .select('*')
    .eq('card_id', cardId)
    .order('occurred_at', { ascending: false })
    .limit(200)

  return resultFromSupabase((data ?? []) as AccountLedger[], error, 'Hesap hareketleri yüklenemedi.')
}

export async function fetchCardLedgerEvents(cardId: string): Promise<Result<CardLedger[]>> {
  const { data, error } = await supabase
    .from('card_ledger')
    .select('*')
    .eq('card_id', cardId)
    .order('occurred_at', { ascending: false })
    .limit(200)

  return resultFromSupabase((data ?? []) as CardLedger[], error, 'Kart borç hareketleri yüklenemedi.')
}

export async function fetchCardLedgerEventsSince(cardId: string, since: string): Promise<Result<CardLedger[]>> {
  const { data, error } = await supabase
    .from('card_ledger')
    .select('*')
    .eq('card_id', cardId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(200)

  return resultFromSupabase((data ?? []) as CardLedger[], error, 'Kart borç hareketleri yüklenemedi.')
}

export async function fetchAccountLedgerEventsSince(cardId: string, since: string): Promise<Result<AccountLedger[]>> {
  const { data, error } = await supabase
    .from('account_ledger')
    .select('*')
    .eq('card_id', cardId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(200)

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
