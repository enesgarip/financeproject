import { supabase } from '../../lib/supabase'
import type { CardExpense, CardInstallmentIntent } from '../../types/database'
import { appErrorFromSupabase, fail, ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

/**
 * Bekleyen taksit niyeti: alışverişten ÖNCE bırakılan "bu işlem N taksit olacak"
 * notu. Banka SMS'i taksit bilgisi taşımadığı için provizyon her zaman tek çekim
 * doğar; niyet, SMS düştüğü anda `record_sms_card_expense` içinden uygulanır.
 *
 * Para modeline dokunmaz: yalnız provizyonun `installment_count` etiketini yazar
 * (bkz. docs/CARD_DEBT_TRANSITIONS.md).
 */

export type NewCardInstallmentIntent = {
  cardId: string | null
  merchantHint: string | null
  minAmount: number | null
  maxAmount: number | null
  installmentCount: number
  /** Niyetin geçerlilik süresi; sonrasında eşleşmez (yanlış işleme yapışmasın). */
  validDays: number
  note: string | null
}

export async function fetchCardInstallmentIntents(): Promise<Result<CardInstallmentIntent[]>> {
  const { data, error } = await supabase
    .from('card_installment_intents')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return resultFromSupabase((data ?? []) as CardInstallmentIntent[], error, 'Taksit niyetleri yüklenemedi.')
}

export async function insertCardInstallmentIntent(
  userId: string,
  input: NewCardInstallmentIntent,
): Promise<Result<CardInstallmentIntent>> {
  const expiresAt = new Date(Date.now() + Math.max(1, input.validDays) * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from('card_installment_intents')
    .insert({
      user_id: userId,
      card_id: input.cardId,
      merchant_hint: input.merchantHint,
      min_amount: input.minAmount,
      max_amount: input.maxAmount,
      installment_count: input.installmentCount,
      expires_at: expiresAt,
      note: input.note,
    } as never)
    .select()
    .single()

  if (error) return fail(appErrorFromSupabase(error, 'Taksit niyeti kaydedilemedi.'))
  return ok(data as CardInstallmentIntent)
}

/** Niyeti iptal eder (silmez): geçmişte ne beklenmişti görünür kalır. */
export async function cancelCardInstallmentIntent(id: string): Promise<Result<void>> {
  const { error } = await supabase
    .from('card_installment_intents')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'active')

  return voidResultFromSupabase(error, 'Taksit niyeti iptal edilemedi.')
}

export async function deleteCardInstallmentIntent(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('card_installment_intents').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Taksit niyeti silinemedi.')
}

/**
 * Bekleyen bir provizyona uyan niyeti elle uygular. SMS yolu bunu otomatik
 * yapar; bu çağrı niyet SMS'ten SONRA yazıldığında kullanılır.
 */
export async function applyCardInstallmentIntent(expenseId: string): Promise<Result<CardExpense | null>> {
  const { data, error } = await supabase.rpc('apply_card_installment_intent', { p_expense_id: expenseId })
  if (error) return fail(appErrorFromSupabase(error, 'Taksit niyeti uygulanamadı.'))
  return ok((data ?? null) as CardExpense | null)
}
