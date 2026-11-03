import { supabase } from '../lib/supabase'
import type { Card, Json } from '../types/database'
import { userMessage } from '../utils/userMessage'
import { fetchFinanceSnapshot } from '../data/repositories/financeSnapshotRepo'
import { cardPayableDebt } from '../utils/financeSummary'
import { buildStatementPaidMap, statementRemainingAmount } from '../utils/cardStatementPayments'
import { effectiveDebtValue } from '../utils/valuation'
import { roundTL } from '../utils/money'
import type { FinanceObligation } from '../utils/obligations'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../utils/supabaseErrors'

export type FinancePaymentResult = {
  error: SupabaseLikeError | null
}

/** SQL reddinden sonra açık modalın eski tavan/bakiye ile kullanıcıyı döndürmesini önle. */
export async function refreshFinancePaymentState(intent: FinanceObligation) {
  const data = await fetchFinanceSnapshot()
  let amount = intent.amount
  let maxPayableAmount = intent.maxPayableAmount
  if (intent.action === 'settle_debt' || intent.action === 'collect_debt') {
    const row = data.debts.find((row) => row.id === intent.sourceId)
    amount = row?.status === 'açık' ? effectiveDebtValue(row, null) : 0
    maxPayableAmount = amount
  } else if (intent.action === 'pay_card_statement') {
    const row = data.cardStatements.find((row) => row.id === intent.sourceId)
    amount = row?.status === 'open' ? statementRemainingAmount(row, buildStatementPaidMap(data.cardStatementPayments)) : 0
    maxPayableAmount = amount
  } else if (intent.action === 'pay_card_debt') {
    const row = data.cards.find((row) => row.id === intent.sourceId)
    amount = row?.statement_debt_amount ?? 0
    maxPayableAmount = row ? cardPayableDebt(row) : 0
  } else if (intent.action === 'pay_loan_installment') {
    const row = data.loanInstallments.find((row) => row.id === intent.sourceId)
    amount = row?.status !== 'ödendi' ? row?.amount ?? 0 : 0
  } else if (intent.action === 'pay_payment') {
    const row = data.payments.find((row) => row.id === intent.sourceId)
    amount = row?.status === 'bekliyor' ? row.amount : 0
  }
  return { intent: { ...intent, amount, maxPayableAmount, minimumPaymentBase: amount }, accounts: getAccountsForObligation(intent, data.cards) }
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
  if (!obligation) return 'Ödeme kaydı'
  if (obligation.action === 'collect_debt') return 'Tahsilat kaydı'
  if (obligation.action === 'settle_debt') return 'Borç ödeme kaydı'
  if (obligation.action === 'pay_card_statement') return 'Ekstre ödemesi'
  if (obligation.action === 'pay_card_debt') return 'Kart borcu ödeme kaydı'
  if (obligation.action === 'pay_loan_installment') return 'Taksit ödemesi'
  return 'Ödeme kaydı'
}

export function submitLabelForObligation(obligation: FinanceObligation | null) {
  if (!obligation) return 'Kaydet'
  if (obligation.action === 'collect_debt') return 'Tahsilatı kaydet'
  return 'Ödemeyi kaydet'
}

export function accountLabelForObligation(obligation: FinanceObligation | null) {
  return obligation?.action === 'collect_debt' ? 'Paranın geldiği hesap' : 'Ödemenin yapıldığı hesap'
}

export function amountLabelForObligation(obligation: FinanceObligation | null) {
  if (obligation?.action === 'collect_debt') return 'Tahsilat tutarı'
  if (obligation?.action === 'settle_debt') return 'Ödeme tutarı'
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
  return obligation?.action === 'pay_payment'
    || obligation?.action === 'pay_card_debt'
    // K7: ekstre de kısmi/asgari ödenebilir (append-only card_statement_payments).
    || obligation?.action === 'pay_card_statement'
    || obligation?.action === 'settle_debt'
    || obligation?.action === 'collect_debt'
}

export { estimatedMinimumCardPayment, minimumCardPaymentRate } from '../utils/financeObligationRules'

export type RecentSmsAccountMovement = {
  occurredAt: string
  title: string
}

// B4: Kullanıcı kart borcunu bankada ödediğinde hesap SMS'i bakiyeyi ZATEN
// düşürmüş olabilir (record_sms_account_movement). Aynı hesapta son 3 günde
// aynı tutarlı SMS kaynaklı hareket varsa ödeme çekmecesi "tekrar oynatma"
// seçeneği sunar; RPC'ler p_skip_source_debit / p_skip_account_move ile
// bakiyeye dokunmaz. Yön: kart/borç ödemesi çıkış ("… gonderimi"), alacak
// tahsilatı giriş ("… geldi") — başlık SMS RPC'sinin sabit kalıbıdır.
export async function findRecentSmsAccountMovement(
  accountId: string,
  amount: number,
  direction: 'in' | 'out' = 'out',
): Promise<RecentSmsAccountMovement | null> {
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
    .like('title', direction === 'in' ? '% geldi' : '% gonderimi')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const row = data[0] as { occurred_at: string; title: string }
  return { occurredAt: row.occurred_at, title: row.title }
}

/** Gerçek ödeme günü desteklenen aksiyonlar (B9): planlı ödeme ve kredi taksiti. */
export function obligationSupportsPaidAt(obligation: FinanceObligation | null | undefined): boolean {
  return obligation?.action === 'pay_payment' || obligation?.action === 'pay_loan_installment'
}

export async function submitFinanceObligationPayment({
  requestId,
  obligation,
  account,
  amount,
  skipSourceDebit = false,
  paidAt,
}: {
  requestId: string
  obligation: FinanceObligation
  account: Pick<Card, 'id'> | null
  amount: number
  skipSourceDebit?: boolean
  /** Gerçek ödeme günü (YYYY-MM-DD). Boş/bugün ise RPC bugünü kullanır. */
  paidAt?: string
}): Promise<FinancePaymentResult> {
  if (!obligation.action) return { error: { message: 'Bu kayıt doğrudan ödenebilir bir aksiyon taşımıyor.' } }

  let submitError: SupabaseLikeError | null = null
  // Domain RPC'lerin ownership/ledger kuralları aynıdır; ortak transaction
  // makbuzu tam ve kısmi bütün drawer ödemelerini tekrar güvenli yapar.
  const paymentRpc = (method: string, args: Json) => supabase.rpc('submit_finance_payment', {
    p_request_id: requestId, p_method: method, p_args: args,
  })
  const paidAtArg = paidAt ? { p_paid_at: paidAt } : {}

  if (obligation.action === 'pay_payment') {
    const { error } = await paymentRpc('pay_payment', {
      p_payment_id: obligation.sourceId,
      p_source_card_id: account?.id ?? null,
      p_paid_amount: amount,
      p_outside_accounts: account === null,
      ...paidAtArg,
    })

    submitError = error

  } else if (obligation.action === 'pay_card_statement') {
    if (!account) return { error: { message: 'Ekstre ödemesi için kaynak hesap seçmelisin.' } }
    // Tutar tam ödemede de açıktır: başka sekme kalanı değiştirdiyse "null =
    // şu anki tamamı" kullanıcının girdiği tutardan farklı para oynatmamalı.
    const { error } = await paymentRpc('pay_card_statement', {
      p_statement_id: obligation.sourceId,
      p_source_card_id: account.id,
      p_skip_source_debit: skipSourceDebit,
      p_amount: roundTL(amount),
    })
    submitError = error
  } else if (obligation.action === 'pay_card_debt') {
    if (!account) return { error: { message: 'Kart borcu ödemesi için kaynak hesap seçmelisin.' } }
    const { error } = await paymentRpc('pay_card_debt', {
      p_card_id: obligation.sourceId,
      p_source_card_id: account.id,
      p_amount: amount,
      p_skip_source_debit: skipSourceDebit,
    })
    submitError = error
  } else if (obligation.action === 'pay_loan_installment') {
    if (!account) return { error: { message: 'Kredi taksiti için kaynak hesap seçmelisin.' } }
    const { error } = await paymentRpc('pay_loan_installment', {
      p_installment_id: obligation.sourceId,
      p_source_card_id: account.id,
      ...paidAtArg,
    })
    submitError = error
  } else if (obligation.action === 'settle_debt' || obligation.action === 'collect_debt') {
    if (!account) return { error: { message: 'Borç/alacak işlemi için kaynak hesap seçmelisin.' } }
    // Kalanla aynı tutar RPC'de tam kapamadır; eski ekrandan gelen tam ödeme
    // artık null ile sessizce yeni bir tutara dönüşmez. Para iki ondalıktır.
    const { error } = await paymentRpc('settle_personal_debt', {
      p_debt_id: obligation.sourceId,
      p_account_card_id: account.id,
      p_amount: roundTL(amount),
      // Para SMS ile zaten hesaba girdi/çıktı: yalnız kaydı kapat.
      p_skip_account_move: skipSourceDebit,
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

  return { error: submitError ? { ...submitError, message: userMessage(submitError.message, submitError.code) } : null }
}
