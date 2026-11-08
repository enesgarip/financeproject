import { readAllRows, sortRowsBy } from './readAllRows'
import { supabase } from '../../lib/supabase'
import type { CardExpense, NetWorthSnapshot, SavingsGoalSnapshot, TransactionHistory } from '../../types/database'
import { addMonths, dateInputValue, startOfMonth } from '../../utils/date'
import type { GoalSnapshotEntry } from '../../utils/goalSnapshots'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'
import { ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'
import type { CategoryHistory } from '../../utils/categorySpending'

/** Kategori geçmişi snapshot'ın ay/arşiv sınırından bağımsızdır. Her sayfa
 * tamamlanmadan toplam yayımlanmaz; UUID imleci aynı tarihli satırları korur. */
export async function fetchCategorySpendingHistory(): Promise<Result<CategoryHistory>> {
  async function read<T extends { id: string }>(table: 'card_expenses' | 'card_installments' | 'card_statement_archives', columns: string): Promise<Result<T[]>> {
    const rows: T[] = []
    let before: string | null = null
    for (;;) {
      let query = supabase.from(table).select(columns).order('id', { ascending: false })
      if (before) query = query.lt('id', before)
      const { data, error } = await query.limit(500)
      if (error) return resultFromSupabase<T[]>([], error, 'Kategori geçmişi tamamen yüklenemedi.')
      const page = (data ?? []) as unknown as T[]
      rows.push(...page)
      if (page.length < 500) return ok(rows)
      const next = page.at(-1)?.id
      if (!next || (before && next >= before)) return resultFromSupabase<T[]>([], { message: 'Kategori geçmişinin devamı doğrulanamadı.' })
      before = next
    }
  }
  const [expenses, installments, statements] = await Promise.all([
    read<CategoryHistory['expenses'][number]>('card_expenses', 'id,card_id,statement_archive_id,spent_at,amount,description,category,installment_count,status'),
    read<CategoryHistory['installments'][number]>('card_installments', 'id,card_id,card_expense_id,statement_archive_id,due_month,amount,description,category,installment_no,installment_count,status'),
    read<CategoryHistory['statements'][number]>('card_statement_archives', 'id,card_id,statement_date,statement_debt_amount'),
  ])
  if (!expenses.ok) return expenses
  if (!installments.ok) return installments
  if (!statements.ok) return statements
  return ok({ expenses: expenses.data, installments: installments.data, statements: statements.data })
}

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

/** Bugünün hedef fotoğraflarını yazar (idempotent upsert). Net değer
 *  fotoğrafıyla aynı günlük koşuda alınır (app/useDailyNetWorthSnapshot);
 *  tutar TÜRETİLMİŞ biriken değerdir, okuma tarafı tempo/varış şeridiyle gelir. */
export async function recordSavingsGoalSnapshots(
  userId: string,
  entries: GoalSnapshotEntry[],
): Promise<Result<boolean>> {
  if (entries.length === 0) return ok(false)
  const today = new Date().toLocaleDateString('sv-SE')
  const { error } = await supabase
    .from('savings_goal_snapshots')
    .upsert(
      entries.map((entry) => ({ user_id: userId, goal_id: entry.goalId, snapshot_date: today, amount: entry.amount })),
      { onConflict: 'goal_id,snapshot_date' },
    )

  // Tablo deploy edilmemişse sessizce geç (migration drift'i kullanıcıyı bloklamaz).
  if (isMissingSupabaseCapabilityError(error)) return ok(false)
  const result = voidResultFromSupabase(error, 'Hedef fotoğrafı kaydedilemedi.')
  return result.ok ? ok(true) : result
}

export async function fetchNetWorthSnapshots(): Promise<Result<NetWorthSnapshot[] | null>> {
  const response = await readAllRows('net_worth_snapshots')
  const error = response.error
  const data = sortRowsBy(response.data ?? [], 'snapshot_date').slice(0, NET_WORTH_SNAPSHOT_LIMIT)

  if (isMissingSupabaseCapabilityError(error)) return ok(null)
  return resultFromSupabase([...(data ?? [])].reverse() as NetWorthSnapshot[], error, 'Net değer serisi yüklenemedi.')
}

// Tempo penceresi 90 gün; birkaç hedef × günlük satırda 2000 bolca yeter.
const SAVINGS_GOAL_SNAPSHOT_LIMIT = 2000

export async function fetchSavingsGoalSnapshots(): Promise<Result<SavingsGoalSnapshot[] | null>> {
  const response = await readAllRows('savings_goal_snapshots')
  const error = response.error
  const data = sortRowsBy(response.data ?? [], 'snapshot_date').slice(0, SAVINGS_GOAL_SNAPSHOT_LIMIT)

  if (isMissingSupabaseCapabilityError(error)) return ok(null)
  return resultFromSupabase(
    [...(data ?? [])].reverse() as SavingsGoalSnapshot[],
    error,
    'Hedef fotoğraf serisi yüklenemedi.',
  )
}

export type PriceRadarRows = {
  transactionHistory: TransactionHistory[]
  cardExpenses: CardExpense[]
}

export async function fetchPriceRadarRows(): Promise<Result<PriceRadarRows>> {
  const radarStart = dateInputValue(addMonths(startOfMonth(), 1 - PRICE_RADAR_MONTHS))
  const [history, expenses] = await Promise.all([
    readAllRows('transaction_history', [{ column: 'type', op: 'eq', value: 'payment' }, { column: 'occurred_at', op: 'gte', value: radarStart }]),
    readAllRows('card_expenses', [{ column: 'status', op: 'eq', value: 'posted' }, { column: 'spent_at', op: 'gte', value: radarStart }]),
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
