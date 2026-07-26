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

/** Bugünün net değer noktasını yazar (idempotent upsert). Kayıt app açılışında
 *  alınır (app/useDailyNetWorthSnapshot); okuma tarafı ayrıdır. */
export async function recordNetWorthSnapshot(
  userId: string,
  input: NetWorthSnapshotInput,
): Promise<Result<boolean>> {
  const today = new Date().toLocaleDateString('sv-SE')
  const { error } = await supabase
    .from('net_worth_snapshots')
    .upsert(
      { user_id: userId, snapshot_date: today, net_worth: input.netWorth, gold_try: input.goldTry, usd_try: input.usdTry },
      { onConflict: 'user_id,snapshot_date' },
    )

  // Tablo deploy edilmemişse sessizce geç (migration drift'i kullanıcıyı bloklamaz).
  if (isMissingSupabaseCapabilityError(error)) return ok(false)
  const result = voidResultFromSupabase(error, 'Net değer snapshot kaydedilemedi.')
  return result.ok ? ok(true) : result
}

export async function fetchNetWorthSnapshots(): Promise<Result<NetWorthSnapshot[] | null>> {
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(NET_WORTH_SNAPSHOT_LIMIT)

  if (isMissingSupabaseCapabilityError(error)) return ok(null)
  return resultFromSupabase([...(data ?? [])].reverse() as NetWorthSnapshot[], error, 'Net değer serisi yüklenemedi.')
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
