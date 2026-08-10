import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'
import { roundTL } from '../utils/money'
import type { FinanceObligation } from '../utils/obligations'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../utils/supabaseErrors'

export type FinancePaymentResult = {
  error: SupabaseLikeError | null
}

function missingCapabilityFeatureForObligation(obligation: FinanceObligation) {
  if (obligation.action === 'pay_card_statement') return 'Ekstre ödeme altyapısı'
  if (obligation.action === 'pay_card_debt') return 'Kart borcu ödeme altyapısı'
  if (obligation.action === 'pay_loan_installment') return 'Kredi taksiti ödeme altyapısı'
  if (obligation.action === 'settle_debt' || obligation.action === 'collect_debt') return 'Borç/alacak kapatma altyapısı'
  return 'Ödeme altyapısı'
}

export function sortPaymentAccounts(cards: Card[]) {
  return [...cards].sort((left, right) => {
    if (left.card_type !== right.card_type) return left.card_type === 'banka_karti' ? -1 : 1
    return `${left.bank_name} ${left.card_name}`.localeCompare(`${right.bank_name} ${right.card_name}`, 'tr')
  })
}

export function getAccountsForObligation(obligation: FinanceObligation, cards: Card[]) {
  const bankOnly = obligation.action !== 'pay_payment'
  const accounts = bankOnly
    ? cards.filter((card) => card.card_type === 'banka_karti' && card.id !== obligation.relatedCardId)
    : cards

  return sortPaymentAccounts(accounts)
}

export function lastUsedKeyForObligation(obligation: FinanceObligation) {
  if (obligation.action === 'pay_loan_installment') return 'loanAccount'
  if (obligation.action === 'settle_debt' || obligation.action === 'collect_debt') return 'debtAccount'
  return 'paymentAccount'
}

export function modalTitleForObligation(obligation: FinanceObligation | null) {
  if (!obligation) return 'Ödeme yap'
  if (obligation.action === 'collect_debt') return 'Alacağı tahsil et'
  if (obligation.action === 'settle_debt') return 'Borcu öde'
  if (obligation.action === 'pay_card_statement') return 'Ekstre ödemesi'
  if (obligation.action === 'pay_card_debt') return 'Kredi kartı borç ödeme'
  if (obligation.action === 'pay_loan_installment') return 'Taksit ödemesi'
  return 'Ödeme yap'
}

export function submitLabelForObligation(obligation: FinanceObligation | null) {
  if (!obligation) return 'İşlemi tamamla'
  if (obligation.action === 'collect_debt') return 'Tahsilatı tamamla'
  if (obligation.action === 'settle_debt') return 'Borcu öde'
  if (obligation.action === 'pay_card_statement') return 'Ekstreyi öde'
  if (obligation.action === 'pay_card_debt') return 'Borç öde'
  if (obligation.action === 'pay_loan_installment') return 'Taksiti öde'
  return 'Ödemeyi tamamla'
}

export function accountLabelForObligation(obligation: FinanceObligation | null) {
  return obligation?.action === 'collect_debt' ? 'Tahsilat hesabı' : 'Kaynak hesap'
}

export function amountLabelForObligation(obligation: FinanceObligation | null) {
  if (obligation?.action === 'collect_debt') return 'Tahsilat tutarı'
  if (obligation?.action === 'pay_payment') return 'Ödenen gerçek tutar'
  if (obligation?.action === 'pay_card_debt') return 'Ödeme tutarı'
  return 'Tutar'
}

export function emptyAccountMessageForObligation(obligation: FinanceObligation | null) {
  if (obligation?.action === 'pay_payment') return 'Kullanılabilir banka hesabı veya kredi kartı yok.'
  if (obligation?.action === 'collect_debt') return 'Tahsilat için önce bir banka hesabı eklemelisin.'
  return 'Ödeme için önce bir banka hesabı eklemelisin.'
}

export function obligationAmountEditable(obligation: FinanceObligation | null) {
  return obligation?.action === 'pay_payment' || obligation?.action === 'pay_card_debt'
}

export function estimatedMinimumCardPayment(amount: number, rate = 0.2) {
  return roundTL(Math.max(0, amount) * rate)
}

export type RecentSmsAccountDebit = {
  occurredAt: string
  title: string
}

// B4: Kullanıcı kart borcunu bankada ödediğinde hesap SMS'i bakiyeyi ZATEN
// düşürmüş olabilir (record_sms_account_movement). Aynı hesapta son 3 günde
// aynı tutarlı SMS kaynaklı çıkış varsa ödeme çekmecesi "tekrar düşme"
// seçeneği sunar; RPC'ler p_skip_source_debit ile bakiyeye dokunmaz.
export async function findRecentSmsAccountDebit(
  accountId: string,
  amount: number,
): Promise<RecentSmsAccountDebit | null> {
  const rounded = roundTL(amount)
  if (rounded <= 0) return null

  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('transaction_history')
    .select('occurred_at, title')
    .eq('source_table', 'cards')
    .eq('source_id', accountId)
    .eq('type', 'transfer')
    .eq('amount', rounded)
    .eq('note', 'SMS otomasyonu ile kaydedildi.')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const row = data[0] as { occurred_at: string; title: string }
  return { occurredAt: row.occurred_at, title: row.title }
}

export async function submitFinanceObligationPayment({
  obligation,
  account,
  amount,
  skipSourceDebit = false,
}: {
  obligation: FinanceObligation
  account: Card
  amount: number
  skipSourceDebit?: boolean
}): Promise<FinancePaymentResult> {
  if (!obligation.action) return { error: { message: 'Bu kayıt doğrudan ödenebilir bir aksiyon taşımıyor.' } }

  let submitError: SupabaseLikeError | null = null

  if (obligation.action === 'pay_payment') {
    const { error } = await supabase.rpc('pay_payment', {
      p_payment_id: obligation.sourceId,
      p_source_card_id: account.id,
      p_paid_amount: amount,
    })

    submitError = error

  } else if (obligation.action === 'pay_card_statement') {
    const { error } = await supabase.rpc('pay_card_statement', {
      p_statement_id: obligation.sourceId,
      p_source_card_id: account.id,
      p_skip_source_debit: skipSourceDebit,
    })
    submitError = error
  } else if (obligation.action === 'pay_card_debt') {
    const { error } = await supabase.rpc('pay_card_debt', {
      p_card_id: obligation.sourceId,
      p_source_card_id: account.id,
      p_amount: amount,
      p_skip_source_debit: skipSourceDebit,
    })
    submitError = error
  } else if (obligation.action === 'pay_loan_installment') {
    const { error } = await supabase.rpc('pay_loan_installment', {
      p_installment_id: obligation.sourceId,
      p_source_card_id: account.id,
    })
    submitError = error
  } else if (obligation.action === 'settle_debt' || obligation.action === 'collect_debt') {
    const { error } = await supabase.rpc('settle_personal_debt', {
      p_debt_id: obligation.sourceId,
      p_account_card_id: account.id,
    })
    submitError = error
  }

  if (submitError && isMissingSupabaseCapabilityError(submitError)) {
    return {
      error: {
        ...submitError,
        message: missingSupabaseCapabilityMessage(missingCapabilityFeatureForObligation(obligation), submitError),
      },
    }
  }

  return { error: submitError }
}
