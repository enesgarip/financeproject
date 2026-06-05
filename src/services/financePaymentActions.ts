import { supabase } from '../lib/supabase'
import type { Card } from '../types/database'
import type { FinanceObligation } from '../utils/obligations'
import { isMissingSupabaseCapabilityError, type SupabaseLikeError } from '../utils/supabaseErrors'

export type FinancePaymentResult = {
  error: SupabaseLikeError | null
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

export async function submitFinanceObligationPayment({
  obligation,
  account,
  amount,
}: {
  obligation: FinanceObligation
  account: Card
  amount: number
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

    if (submitError && isMissingSupabaseCapabilityError(submitError)) {
      const { error: updateError } = await supabase
        .from('payments')
        .update({ amount, updated_at: new Date().toISOString() })
        .eq('id', obligation.sourceId)

      if (updateError) {
        submitError = updateError
      } else {
        const { error: legacyError } = await supabase.rpc('pay_payment', {
          p_payment_id: obligation.sourceId,
          p_source_card_id: account.id,
        })
        submitError = legacyError
      }
    }
  } else if (obligation.action === 'pay_card_statement') {
    const { error } = await supabase.rpc('pay_card_statement', {
      p_statement_id: obligation.sourceId,
      p_source_card_id: account.id,
    })
    submitError = error
  } else if (obligation.action === 'pay_card_debt') {
    const { error } = await supabase.rpc('pay_card_debt', {
      p_card_id: obligation.sourceId,
      p_source_card_id: account.id,
      p_amount: amount,
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

  return { error: submitError }
}
