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

  return resultFromSupabase((data ?? []) as AccountLedger[], error, 'Hesap hareketleri yuklenemedi.')
}

export async function fetchCardLedgerEvents(cardId: string): Promise<Result<CardLedger[]>> {
  const { data, error } = await supabase
    .from('card_ledger')
    .select('*')
    .eq('card_id', cardId)
    .order('occurred_at', { ascending: false })
    .limit(200)

  return resultFromSupabase((data ?? []) as CardLedger[], error, 'Kart borc hareketleri yuklenemedi.')
}

export async function fetchAccountReconciliations(): Promise<Result<AccountReconciliation[]>> {
  const { data, error } = await supabase
    .from('account_reconciliations')
    .select('*')
    .order('reconciled_at', { ascending: false })

  return resultFromSupabase((data ?? []) as AccountReconciliation[], error, 'Mutabakat kayitlari yuklenemedi.')
}

export async function insertAccountReconciliation(
  payload: InsertFor<'account_reconciliations'>,
): Promise<Result<void>> {
  const { error } = await supabase.from('account_reconciliations').insert(payload)
  return voidResultFromSupabase(error, 'Mutabakat kaydedilemedi.')
}
