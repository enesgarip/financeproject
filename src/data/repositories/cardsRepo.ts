import { supabase } from '../../lib/supabase'
import type { Card, CardExpense, CardExpenseSource, CardInstallment, CardStatementArchive, CardStatementPayment, Json, Payment } from '../../types/database'
import { ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'
import { roundTL } from '../../utils/money'

export type ExpenseMatchRow = Pick<CardExpense, 'id' | 'spent_at' | 'amount' | 'status' | 'description' | 'category' | 'installment_count' | 'note'>
export type InstallmentMatchRow = Pick<CardInstallment, 'id' | 'card_expense_id' | 'due_month' | 'amount' | 'status' | 'description' | 'installment_no' | 'installment_count' | 'statement_archive_id'>
export type PaymentMatchRow = Pick<
  Payment,
  'id' | 'title' | 'amount' | 'amount_status' | 'due_date' | 'status' | 'payment_method' | 'auto_source_card_id' | 'category' | 'recurrence' | 'recurrence_day' | 'recurrence_end_date'
>

export async function fetchCards(): Promise<Result<Card[]>> {
  const { data, error } = await supabase.from('cards').select('*')
  return resultFromSupabase((data as Card[]) ?? [], error, 'Kartlar yüklenemedi.')
}

export async function fetchCardsByType(cardType: Card['card_type']): Promise<Result<Card[]>> {
  const { data, error } = await supabase.from('cards').select('*').eq('card_type', cardType)
  return resultFromSupabase((data as Card[]) ?? [], error, 'Kartlar yüklenemedi.')
}

/**
 * Tek bir kartın güncel satırını çeker. Ekstre import kilidinde, içe aktarma +
 * düzeltmeler sonrası TAZE borç kovalarını (statement/current) okumak için
 * kullanılır; prop olarak gelen kart snapshot'ı bayatlamış olur.
 */
export async function fetchCardById(cardId: string): Promise<Result<Card>> {
  const { data, error } = await supabase.from('cards').select('*').eq('id', cardId).single()
  return resultFromSupabase(data as Card, error, 'Kart yüklenemedi.')
}

export async function fetchProvisionExpenses(): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('*')
    .eq('status', 'provision')
    .order('spent_at', { ascending: false })

  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Provizyonlar yüklenemedi.')
}

export async function fetchStatementArchives(limit: number): Promise<Result<CardStatementArchive[]>> {
  const { data, error } = await supabase
    .from('card_statement_archives')
    .select('*')
    .order('statement_date', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as CardStatementArchive[], error, 'Ekstreler yüklenemedi.')
}

/**
 * Kısmi ekstre ödemeleri (K7). Arşivin kalan borcu bu satırlardan türer, o
 * yüzden ekstre gösteren her ekran arşivlerle BİRLİKTE bunu da yükler.
 */
export async function fetchStatementPayments(): Promise<Result<CardStatementPayment[]>> {
  const { data, error } = await supabase
    .from('card_statement_payments')
    .select('*')
    .order('paid_at', { ascending: false })

  return resultFromSupabase((data ?? []) as CardStatementPayment[], error, 'Ekstre ödemeleri yüklenemedi.')
}

// Yalnız açık (ödenmemiş) ekstre arşivleri. Borçlar sayfası pay_card_debt
// butonunu açık ekstre varken kapatmak için kullanır: pay_card_debt arşivi
// kapatmadan statement kovasını düşürür ve ekstre ikinci kez ödenebilir kalırdı.
export async function fetchOpenStatementArchives(): Promise<Result<CardStatementArchive[]>> {
  const { data, error } = await supabase
    .from('card_statement_archives')
    .select('*')
    .eq('status', 'open')
    .order('due_date', { ascending: true })

  return resultFromSupabase((data ?? []) as CardStatementArchive[], error, 'Açık ekstreler yüklenemedi.')
}

export async function fetchCardInstallments(): Promise<Result<CardInstallment[]>> {
  const { data, error } = await supabase
    .from('card_installments')
    .select('*')
    .order('due_month', { ascending: true })

  return resultFromSupabase((data ?? []) as CardInstallment[], error, 'Kart taksitleri yüklenemedi.')
}

// Taksit + bağlı arşivin durumu. Ödenmişlik satırdan değil kanıttan türetilir
// (bkz. utils/cardInstallmentCalendar.ts isInstallmentSettled): ekstre ödemesi
// taksit satırına dokunmaz, bu yüzden arşiv statüsü satırla birlikte gelmeli.
export type CardInstallmentWithArchive = CardInstallment & {
  statement_archive: { status: string | null } | null
}

export async function fetchCardInstallmentsByExpenseIds(expenseIds: string[]): Promise<Result<CardInstallmentWithArchive[]>> {
  if (expenseIds.length === 0) return ok([])

  const { data, error } = await supabase
    .from('card_installments')
    .select('*, statement_archive:card_statement_archives(status)')
    .in('card_expense_id', expenseIds)
    .order('due_month', { ascending: true })
    .order('installment_no', { ascending: true })

  // El yazımı Database tipi ilişki metadata'sı taşımadığı için embed dönüşü
  // burada tek noktadan çevrilir; FK (20260602131850) DB'de mevcut.
  return resultFromSupabase((data ?? []) as unknown as CardInstallmentWithArchive[], error, 'Kart taksitleri yüklenemedi.')
}

export async function fetchPostedInstallmentExpenses(limit: number): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('*')
    .eq('status', 'posted')
    .gt('installment_count', 1)
    .order('spent_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Taksitli harcamalar yüklenemedi.')
}

export async function fetchRecentCardExpenses(limit: number): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('*')
    .eq('status', 'posted')
    .order('created_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Son harcamalar yüklenemedi.')
}

/**
 * Bağlam etiketlemesi için harcama listesi. `fetchRecentCardExpenses`'ten farkı:
 * provizyonları da kapsar (SMS'ten yeni düşen harcamalar önce `provision` gelir,
 * kesinleşene kadar listede olmazsa bağlam atanamıyordu) ve harcama tarihine göre
 * sıralar. Etiketleme kart borcunu değiştirmediği için provizyonu dahil etmek güvenli.
 */
export async function fetchTaggableCardExpenses(limit: number): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('*')
    .in('status', ['posted', 'provision'])
    .order('spent_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Son harcamalar yüklenemedi.')
}

export async function fetchCardExpenseMatchRows(cardId: string): Promise<Result<ExpenseMatchRow[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('id, spent_at, amount, status, description, category, installment_count, note')
    .eq('card_id', cardId)

  return resultFromSupabase((data ?? []) as ExpenseMatchRow[], error, 'Kart harcamaları yüklenemedi.')
}

export async function fetchCardPaymentMatchRows(cardId: string): Promise<Result<PaymentMatchRow[]>> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, title, amount, amount_status, due_date, status, payment_method, auto_source_card_id, category, recurrence, recurrence_day, recurrence_end_date')
    .eq('status', 'bekliyor')
    .gt('amount', 0)
    .or(`auto_source_card_id.is.null,auto_source_card_id.eq.${cardId}`)

  return resultFromSupabase((data ?? []) as PaymentMatchRow[], error, 'Planlı ödemeler yüklenemedi.')
}

export type AddCardExpenseInput = {
  cardId: string
  amount: number
  description: string
  spentAt: string
  category: string
  installmentCount: number
  status: CardExpense['status']
  /** Kaydın kaynağı; verilmezse 'manual'. Otomasyon kapsamı bundan ölçülür. */
  source?: CardExpenseSource
  /** Aynı mantıksal kaynak olayının retry'larını tekilleştiren kararlı kimlik. */
  sourceEventId?: string
  /** Harcamayı bir araca etiketler (Arabalarım). Borç RPC'sine dokunmaz. */
  carId?: string | null
}

export async function addCardExpense(input: AddCardExpenseInput): Promise<Result<void>> {
  const { data, error } = await supabase.rpc('add_card_expense', {
    p_card_id: input.cardId,
    p_amount: input.amount,
    p_description: input.description,
    p_spent_at: input.spentAt,
    p_category: input.category,
    p_installment_count: input.installmentCount,
    p_status: input.status,
    p_source: input.source ?? 'manual',
    p_source_event_id: input.sourceEventId ?? null,
  })

  if (error) return voidResultFromSupabase(error, 'Harcama kaydedilemedi.')
  return tagExpenseCar((data as CardExpense | null)?.id, input.carId)
}

/**
 * add_card_expense / carryover RPC'leri oluşturdukları card_expenses satırını
 * döndürür. Araç seçildiyse o satıra car_id etiketini ayrı UPDATE ile atarız
 * (saf annotation, borca dokunmaz — updateCardExpenseCategory ile aynı desen).
 */
async function tagExpenseCar(expenseId: string | undefined, carId: string | null | undefined): Promise<Result<void>> {
  if (!carId || !expenseId) return ok(undefined)
  const { error } = await supabase.from('card_expenses').update({ car_id: carId }).eq('id', expenseId)
  return voidResultFromSupabase(error, 'Harcama kaydedildi ama araca atanamadı.')
}

export type PayPaymentFromCardImportInput = {
  paymentId: string
  sourceCardId: string
  amount: number
  spentAt: string
  sourceEventId: string
  source: Extract<CardExpenseSource, 'statement_import' | 'movement_import'>
}

export async function payPaymentFromCardImport(input: PayPaymentFromCardImportInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('pay_payment_from_card_import', {
    p_payment_id: input.paymentId,
    p_source_card_id: input.sourceCardId,
    p_paid_amount: input.amount,
    p_spent_at: input.spentAt,
    p_source_event_id: input.sourceEventId,
    p_source: input.source,
  })

  return voidResultFromSupabase(error, 'Planlı ödeme kart hareketine işlenemedi.')
}

export type CardInstallmentCarryoverInput = {
  cardId: string
  description: string
  installmentAmount: number
  totalInstallments: number
  paidInstallments: number
  nextDueDate: string
  category: string
  sourceEventId?: string
  /** Taksit devrini bir araca etiketler (Arabalarım). Borca dokunmaz. */
  carId?: string | null
}

export async function fetchCardInstallmentMatchRows(cardId: string): Promise<Result<InstallmentMatchRow[]>> {
  const { data, error } = await supabase
    .from('card_installments')
    .select('id, card_expense_id, due_month, amount, status, description, installment_no, installment_count, statement_archive_id')
    .eq('card_id', cardId)

  return resultFromSupabase((data ?? []) as InstallmentMatchRow[], error, 'Kart taksitleri yüklenemedi.')
}

export async function recordCardInstallmentCarryover(input: CardInstallmentCarryoverInput): Promise<Result<void>> {
  const { data, error } = await supabase.rpc('record_card_installment_carryover', {
    p_card_id: input.cardId,
    p_description: input.description,
    p_installment_amount: input.installmentAmount,
    p_total_installments: input.totalInstallments,
    p_paid_installments: input.paidInstallments,
    p_next_due_month: input.nextDueDate,
    p_category: input.category,
    p_source_event_id: input.sourceEventId ?? null,
  })

  if (error) return voidResultFromSupabase(error, 'Taksit devri kaydedilemedi.')
  return tagExpenseCar((data as CardExpense | null)?.id, input.carId)
}

export async function cutDueCardStatements(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('cut_due_card_statements')
  return resultFromSupabase(data ?? 0, error, 'Ekstre kesimi başarısız.')
}

export type CardStatementReplaceAction =
  | {
      kind: 'expense'
      amount: number
      spentAt: string
      installmentCount: number
      description: string
      category: string
      sourceEventId: string
    }
  | {
      kind: 'carryover'
      installmentAmount: number
      totalInstallments: number
      paidInstallments: number
      nextDueDate: string
      description: string
      category: string
      sourceEventId: string
    }
  | {
      kind: 'payment'
      paymentId: string
      amount: number
      spentAt: string
      sourceEventId: string
    }
  | {
      kind: 'adjustment'
      amount: number
      description: string
      spentAt: string
      sourceEventId: string
    }

export type ReplaceCardStatementImportInput = {
  cardId: string
  statementDate: string
  dueDate: string | null
  bankAmount: number
  actions: CardStatementReplaceAction[]
}

export async function replaceCardStatementImport(input: ReplaceCardStatementImportInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('replace_card_statement_import', {
    p_card_id: input.cardId,
    p_statement_date: input.statementDate,
    p_due_date: input.dueDate,
    p_bank_amount: input.bankAmount,
    p_actions: input.actions as Json,
  })
  return voidResultFromSupabase(error, 'Ekstre PDF kaynak gerçeğinden yeniden kurulamadı.')
}

export async function applyCardProvision(expenseId: string, action: 'post' | 'cancel'): Promise<Result<void>> {
  const rpcName = action === 'post' ? 'post_card_provision' : 'cancel_card_provision'
  const { error } = await supabase.rpc(rpcName, { p_expense_id: expenseId })
  return voidResultFromSupabase(error, 'Provizyon islemi tamamlanamadi.')
}

/**
 * Provizyonu kesinleştirmeden önce taksit adedini işaretler. Banka SMS'i toplam
 * tutarla geldiği için provizyon `installment_count=1` açılır; kullanıcı burada
 * "3 taksit" derse kesinleşmede (`post_card_provision`) plan doğru bölünür.
 * Sadece bir etikettir: toplam borç ve provizyon kovası değişmez, taksit satırları
 * yalnız kesinleşmede doğar. `status='provision'` filtresi kesinleşmiş/arşivli bir
 * satıra dokunmayı imkânsız kılar (o yol `update_card_expense`'e aittir).
 */
export async function setProvisionInstallments(
  expenseId: string,
  amount: number,
  installmentCount: number,
): Promise<Result<void>> {
  const count = Math.max(1, Math.min(36, Math.trunc(installmentCount) || 1))
  const installmentAmount = count === 1 ? roundTL(amount) : roundTL(amount / count)
  const { error } = await supabase
    .from('card_expenses')
    .update({ installment_count: count, installment_amount: installmentAmount })
    .eq('id', expenseId)
    .eq('status', 'provision')
  return voidResultFromSupabase(error, 'Taksit bilgisi kaydedilemedi.')
}

export async function cancelCardExpense(expenseId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('cancel_card_expense', { p_expense_id: expenseId })
  return voidResultFromSupabase(error, 'Harcama iptal edilemedi.')
}

export type UpdateCardExpenseInput = {
  expenseId: string
  amount: number
  description: string
  spentAt: string
  installmentCount: number
  category: string
  note: string | null
}

export async function updateCardExpense(input: UpdateCardExpenseInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('update_card_expense', {
    p_expense_id: input.expenseId,
    p_amount: input.amount,
    p_description: input.description,
    p_spent_at: input.spentAt,
    p_installment_count: input.installmentCount,
    p_category: input.category,
    p_note: input.note,
  })

  return voidResultFromSupabase(error, 'Harcama guncellenemedi.')
}

/** "Diğer" kategorisinde kalmış son kesin harcamalar (hızlı kategorileme paneli için). */
export async function fetchUncategorizedExpenses(limit: number): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('*')
    .eq('status', 'posted')
    .eq('category', 'Diğer')
    .order('spent_at', { ascending: false })
    .limit(limit)

  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Kategorisiz harcamalar yüklenemedi.')
}

/** Yalnız kategori alanını günceller; tutar/taksit/borç alanlarına dokunmaz. */
export async function updateCardExpenseCategory(expenseId: string, category: string): Promise<Result<void>> {
  const { error } = await supabase.from('card_expenses').update({ category }).eq('id', expenseId)
  return voidResultFromSupabase(error, 'Kategori güncellenemedi.')
}

export type UpdateCardExpenseHealthMetadataInput = {
  expenseId: string
  description: string
  category: string
  expectedUpdatedAt: string
}

/**
 * Data Health'te kullanıcının doğruladığı açıklama/kategori düzeltmesi.
 * RPC finansal alan kabul etmez; card -> expense kilidi ve stale sürüm
 * doğrulaması sunucu tarafında uygulanır. Açıklama/kategori sınıflandırması
 * finansal arşiv toplamını değiştirmediği için geçmiş kayıtlarda da düzeltilebilir.
 */
export async function updateCardExpenseHealthMetadata(
  input: UpdateCardExpenseHealthMetadataInput,
): Promise<Result<void>> {
  const { error } = await supabase.rpc('update_card_expense_health_metadata', {
    p_expense_id: input.expenseId,
    p_description: input.description,
    p_category: input.category,
    p_expected_updated_at: input.expectedUpdatedAt,
  })
  return voidResultFromSupabase(error, 'Harcama açıklaması/kategorisi güncellenemedi.')
}

/** Otomasyon kapsamı ölçümü için son harcamaların kaynak/nota bilgisi. */
export type ExpenseSourceRow = Pick<CardExpense, 'source' | 'note' | 'amount' | 'status' | 'spent_at'>

export async function fetchExpenseSourceRows(sinceIso: string): Promise<Result<ExpenseSourceRow[]>> {
  const { data, error } = await supabase
    .from('card_expenses')
    .select('source, note, amount, status, spent_at')
    .gte('spent_at', sinceIso)
    .order('spent_at', { ascending: false })

  return resultFromSupabase((data ?? []) as ExpenseSourceRow[], error, 'Harcama kaynakları yüklenemedi.')
}
