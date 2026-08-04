import { supabase } from '../../lib/supabase'
import type { CardExpense, ContextExpense, ExpenseContext, InsertFor, UpdateFor } from '../../types/database'
import { appErrorFromSupabase, fail, ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export async function fetchExpenseContexts(): Promise<Result<ExpenseContext[]>> {
  const { data, error } = await supabase.from('expense_contexts').select('*').order('sort_order').order('created_at')
  return resultFromSupabase((data ?? []) as ExpenseContext[], error, 'Gider bağlamları yüklenemedi.')
}

export async function insertExpenseContext(
  item: Omit<InsertFor<'expense_contexts'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<ExpenseContext>> {
  const { data, error } = await supabase.from('expense_contexts').insert(item).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Bağlam eklenemedi.'))
  return ok(data as ExpenseContext)
}

export async function updateExpenseContext(id: string, fields: UpdateFor<'expense_contexts'>): Promise<Result<ExpenseContext>> {
  const { data, error } = await supabase.from('expense_contexts').update(fields).eq('id', id).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Bağlam güncellenemedi.'))
  return ok(data as ExpenseContext)
}

export async function deleteExpenseContext(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('expense_contexts').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Bağlam silinemedi.')
}

export async function fetchContextExpenses(): Promise<Result<ContextExpense[]>> {
  const { data, error } = await supabase.from('context_expenses').select('*').order('spent_at', { ascending: false })
  return resultFromSupabase((data ?? []) as ContextExpense[], error, 'Bağlam giderleri yüklenemedi.')
}

export async function insertContextExpense(
  item: Omit<InsertFor<'context_expenses'>, 'id' | 'created_at' | 'updated_at'>,
): Promise<Result<ContextExpense>> {
  const { data, error } = await supabase.from('context_expenses').insert(item).select().single()
  if (error) return fail(appErrorFromSupabase(error, 'Gider eklenemedi.'))
  return ok(data as ContextExpense)
}

export async function deleteContextExpense(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('context_expenses').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Gider silinemedi.')
}

export async function fetchTaggedContextCardExpenses(): Promise<Result<CardExpense[]>> {
  const { data, error } = await supabase
    .from('card_expenses').select('*').not('context_id', 'is', null).eq('status', 'posted').order('spent_at', { ascending: false })
  return resultFromSupabase((data ?? []) as CardExpense[], error, 'Etiketli kart harcamaları yüklenemedi.')
}

export async function setCardExpenseContext(expenseId: string, contextId: string | null): Promise<Result<void>> {
  const { error } = await supabase.from('card_expenses').update({ context_id: contextId }).eq('id', expenseId)
  return voidResultFromSupabase(error, 'Kart harcaması bağlama atanamadı.')
}
