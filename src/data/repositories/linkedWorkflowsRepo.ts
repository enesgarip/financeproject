import { supabase } from '../../lib/supabase'
import type { AccountIncomeKind, AccountIncomeLabel, CarServiceCompletion, CarServiceInput, TransactionHistory } from '../../types/database'
import { appErrorFromSupabase, fail, ok, resultFromSupabase, type Result } from '../result'

/** Son 30 gerçek para girişi; düzeltme, açılış ve hesaplar arası transfer dahil değil. */
export async function fetchAccountIncome(accountId: string): Promise<Result<{ movements: TransactionHistory[]; labels: AccountIncomeLabel[]; automaticallyMatched: string[] }>> {
  const movements = await supabase.from('transaction_history').select('*').eq('source_table', 'cards').eq('source_id', accountId).eq('type', 'transfer')
    .or('title.like.% para girişi,title.like.% geldi').gt('amount', 0).order('occurred_at', { ascending: false }).limit(30)
  if (movements.error) return fail(appErrorFromSupabase(movements.error, 'Para girişleri yüklenemedi.'))
  const rows = (movements.data ?? []) as TransactionHistory[]
  if (!rows.length) return ok({ movements: [], labels: [], automaticallyMatched: [] })
  const labels = await supabase.from('account_income_labels').select('*').in('movement_id', rows.map(row => row.id))
  if (labels.error) return fail(appErrorFromSupabase(labels.error, 'Gelir sınıfları yüklenemedi.'))
  const eventIds = rows.flatMap(row => row.source_event_id ? [row.source_event_id] : [])
  if (!eventIds.length) return ok({ movements: rows, labels: labels.data as AccountIncomeLabel[], automaticallyMatched: [] })
  const matches = await supabase.from('transaction_history').select('source_event_id').eq('type', 'debt').in('source_event_id', eventIds)
  if (matches.error) return fail(appErrorFromSupabase(matches.error, 'Otomatik tahsilat eşleşmeleri doğrulanamadı.'))
  return ok({ movements: rows, labels: labels.data as AccountIncomeLabel[], automaticallyMatched: (matches.data ?? []).flatMap(row => row.source_event_id ? [row.source_event_id] : []) })
}

export async function classifyAccountIncome(movementId: string, kind: AccountIncomeKind, debtId: string | null, debtAmount: number | null) {
  const result = await supabase.rpc('classify_account_income', { p_movement_id: movementId, p_kind: kind, p_debt_id: debtId, p_debt_amount: debtAmount })
  return resultFromSupabase(result.data as AccountIncomeLabel | null, result.error, 'Para girişi sınıflandırılamadı.')
}

export async function completeCarService(requestId: string, input: CarServiceInput) {
  const result = await supabase.rpc('complete_car_service', { p_request_id: requestId, p_input: input })
  return resultFromSupabase(result.data as CarServiceCompletion | null, result.error, 'Bakım tamamlanamadı.')
}

export async function fetchCarServiceHistory() {
  const result = await supabase.from('car_service_completions').select('*').order('completed_on', { ascending: false }).limit(50)
  return resultFromSupabase((result.data ?? []) as CarServiceCompletion[], result.error, 'Tamamlanan işler yüklenemedi.')
}
