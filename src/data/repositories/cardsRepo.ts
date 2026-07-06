import { supabase } from '../../lib/supabase'
import type { Card, CardExpense, CardInstallment, CardStatementArchive, Payment } from '../../types/database'
import { ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export type ExpenseMatchRow = Pick<CardExpense, 'id' | 'spent_at' | 'amount' | 'status' | 'description' | 'category' | 'installment_count' | 'note'>
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

export async function fetchCardInstallments(): Promise<Result<CardInstallment[]>> {
  const { data, error } = await supabase
    .from('card_installments')
    .select('*')
    .order('due_month', { ascending: true })

  return resultFromSupabase((data ?? []) as CardInstallment[], error, 'Kart taksitleri yüklenemedi.')
}

export async function fetchCardInstallmentsByExpenseIds(expenseIds: string[]): Promise<Result<CardInstallment[]>> {
  if (expenseIds.length === 0) return ok([])

  const { data, error } = await supabase
    .from('card_installments')
    .select('*')
    .in('card_expense_id', expenseIds)
    .order('due_month', { ascending: true })
    .order('installment_no', { ascending: true })

  return resultFromSupabase((data ?? []) as CardInstallment[], error, 'Kart taksitleri yüklenemedi.')
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
}

export async function addCardExpense(input: AddCardExpenseInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('add_card_expense', {
    p_card_id: input.cardId,
    p_amount: input.amount,
    p_description: input.description,
    p_spent_at: input.spentAt,
    p_category: input.category,
    p_installment_count: input.installmentCount,
    p_status: input.status,
  })

  return voidResultFromSupabase(error, 'Harcama kaydedilemedi.')
}

export type PayPaymentFromCardImportInput = {
  paymentId: string
  sourceCardId: string
  amount: number
  spentAt: string
}

export async function payPaymentFromCardImport(input: PayPaymentFromCardImportInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('pay_payment_from_card_import', {
    p_payment_id: input.paymentId,
    p_source_card_id: input.sourceCardId,
    p_paid_amount: input.amount,
    p_spent_at: input.spentAt,
  })

  return voidResultFromSupabase(error, 'Planlı ödeme kart hareketine işlenemedi.')
}

export type CardInstallmentCarryoverInput = {
  cardId: string
  description: string
  installmentAmount: number
  totalInstallments: number
  paidInstallments: number
  nextDueMonth: string
  category: string
}

export async function recordCardInstallmentCarryover(input: CardInstallmentCarryoverInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('record_card_installment_carryover', {
    p_card_id: input.cardId,
    p_description: input.description,
    p_installment_amount: input.installmentAmount,
    p_total_installments: input.totalInstallments,
    p_paid_installments: input.paidInstallments,
    p_next_due_month: input.nextDueMonth,
    p_category: input.category,
  })

  return voidResultFromSupabase(error, 'Taksit devri kaydedilemedi.')
}

export async function cutDueCardStatements(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('cut_due_card_statements')
  return resultFromSupabase(data ?? 0, error, 'Ekstre kesimi başarısız.')
}

export async function resetCardData(cardId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('reset_card_data', { p_card_id: cardId })
  return voidResultFromSupabase(error, 'Kart sıfırlanamadı.')
}

export async function resetCardImportData(cardId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('reset_card_import_data', { p_card_id: cardId })
  return voidResultFromSupabase(error, 'Kart import verisi sifirlanamadi.')
}

export async function cutCardStatement(cardId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('cut_card_statement', { p_card_id: cardId })
  return voidResultFromSupabase(error, 'Ekstre kesilemedi.')
}

export async function insertGuardStatementArchive(
  userId: string,
  cardId: string,
  periodYear: number,
  periodMonth: number,
  statementDate: string,
): Promise<Result<void>> {
  const { error } = await supabase.from('card_statement_archives').insert({
    user_id: userId,
    card_id: cardId,
    period_year: periodYear,
    period_month: periodMonth,
    statement_date: statementDate,
    statement_debt_amount: 0,
    current_period_spending: 0,
    total_debt_amount: 0,
    status: 'paid',
    note: 'Clean import guard — ekstre kesimi engellendi.',
  })
  return voidResultFromSupabase(error, 'Guard arşiv kaydedilemedi.')
}

export type StatementReconciliationInput = {
  cardId: string
  periodYear: number
  periodMonth: number
  bankAmount: number
  note: string | null
}

export async function setStatementReconciliation(input: StatementReconciliationInput): Promise<Result<void>> {
  const { error } = await supabase.rpc('set_statement_reconciliation', {
    p_card_id: input.cardId,
    p_period_year: input.periodYear,
    p_period_month: input.periodMonth,
    p_bank_amount: input.bankAmount,
    p_note: input.note,
  })

  return voidResultFromSupabase(error, 'Mutabakat kaydedilemedi.')
}

export async function applyCardProvision(expenseId: string, action: 'post' | 'cancel'): Promise<Result<void>> {
  const rpcName = action === 'post' ? 'post_card_provision' : 'cancel_card_provision'
  const { error } = await supabase.rpc(rpcName, { p_expense_id: expenseId })
  return voidResultFromSupabase(error, 'Provizyon islemi tamamlanamadi.')
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
