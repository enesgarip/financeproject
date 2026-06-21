import { supabase } from '../../lib/supabase'
import type { CardExpense, NetWorthSnapshot, TransactionHistory } from '../../types/database'
import { addMonths, dateInputValue, startOfMonth } from '../../utils/date'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'
import { ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export const PRICE_RADAR_MONTHS = 13

// Çok-yıllık trend için (roadmap Y7): istemci uzun aralıkları aylık agrege eder
// (utils/netWorthSeries). ~4 yıl günlük snapshot tek kullanıcı için ucuz.
const NET_WORTH_SNAPSHOT_LIMIT = 1500

export type NetWorthSnapshotInput = {
  netWorth: number
  goldTry: number | null
  usdTry: number | null
}

export async function upsertAndLoadNetWorthSnapshots(
  userId: string,
  input: NetWorthSnapshotInput,
): Promise<Result<NetWorthSnapshot[] | null>> {
  const today = new Date().toLocaleDateString('sv-SE')
  const upsertRes = await supabase
    .from('net_worth_snapshots')
    .upsert(
      { user_id: userId, snapshot_date: today, net_worth: input.netWorth, gold_try: input.goldTry, usd_try: input.usdTry },
      { onConflict: 'user_id,snapshot_date' },
    )

  if (isMissingSupabaseCapabilityError(upsertRes.error)) return ok(null)
  const upsertResult = voidResultFromSupabase(upsertRes.error, 'Net değer snapshot kaydedilemedi.')
  if (!upsertResult.ok) return upsertResult

  const snapshotRes = await supabase
    .from('net_worth_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(NET_WORTH_SNAPSHOT_LIMIT)

  if (isMissingSupabaseCapabilityError(snapshotRes.error)) return ok(null)
  return resultFromSupabase([...(snapshotRes.data ?? [])].reverse() as NetWorthSnapshot[], snapshotRes.error, 'Net değer serisi yüklenemedi.')
}

export type PriceRadarRows = {
  transactionHistory: TransactionHistory[]
  cardExpenses: CardExpense[]
}

export async function fetchPriceRadarRows(): Promise<Result<PriceRadarRows>> {
  const radarStart = dateInputValue(addMonths(startOfMonth(), 1 - PRICE_RADAR_MONTHS))
  const [history, expenses] = await Promise.all([
    supabase
      .from('transaction_history')
      .select('*')
      .eq('type', 'payment')
      .gte('occurred_at', radarStart)
      .order('occurred_at', { ascending: false }),
    supabase
      .from('card_expenses')
      .select('*')
      .eq('status', 'posted')
      .gte('spent_at', radarStart)
      .order('spent_at', { ascending: false }),
  ])

  const error = history.error ?? expenses.error

  return resultFromSupabase(
    {
      transactionHistory: (history.data ?? []) as TransactionHistory[],
      cardExpenses: (expenses.data ?? []) as CardExpense[],
    },
    error,
    'Zam radarı verileri yüklenemedi.',
  )
}
