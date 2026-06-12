import { supabase } from '../../lib/supabase'
import type { InsertFor, LoanInstallment, UpdateFor } from '../../types/database'
import { ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

export async function fetchLoanInstallments(): Promise<Result<LoanInstallment[]>> {
  const { data, error } = await supabase
    .from('loan_installments')
    .select('*')
    .order('due_date', { ascending: true })
    .order('installment_no', { ascending: true })

  return resultFromSupabase((data ?? []) as LoanInstallment[], error, 'Kredi taksitleri yuklenemedi.')
}

export async function fetchLoanInstallmentsByLoan(loanId: string): Promise<Result<LoanInstallment[]>> {
  const { data, error } = await supabase.from('loan_installments').select('*').eq('loan_id', loanId)
  return resultFromSupabase((data ?? []) as LoanInstallment[], error, 'Kredi taksitleri yuklenemedi.')
}

export async function upsertLoanInstallments(payload: InsertFor<'loan_installments'>[]): Promise<Result<void>> {
  if (payload.length === 0) return ok(undefined)

  const { error } = await supabase.from('loan_installments').upsert(payload, { onConflict: 'loan_id,installment_no' })
  return voidResultFromSupabase(error, 'Kredi taksitleri kaydedilemedi.')
}

export async function deleteLoanInstallmentsByIds(ids: string[]): Promise<Result<void>> {
  if (ids.length === 0) return ok(undefined)

  const { error } = await supabase.from('loan_installments').delete().in('id', ids)
  return voidResultFromSupabase(error, 'Kredi taksitleri silinemedi.')
}

export async function updateLoanInstallment(id: string, patch: UpdateFor<'loan_installments'>): Promise<Result<void>> {
  const { error } = await supabase.from('loan_installments').update(patch).eq('id', id)
  return voidResultFromSupabase(error, 'Taksit guncellenemedi.')
}

export async function deleteLoanInstallment(id: string): Promise<Result<void>> {
  const { error } = await supabase.from('loan_installments').delete().eq('id', id)
  return voidResultFromSupabase(error, 'Taksit silinemedi.')
}

export async function payLoanInstallment(installmentId: string, sourceCardId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('pay_loan_installment', {
    p_installment_id: installmentId,
    p_source_card_id: sourceCardId,
  })

  return voidResultFromSupabase(error, 'Odeme islemi tamamlanamadi.')
}
