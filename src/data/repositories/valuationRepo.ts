import { supabase } from '../../lib/supabase'
import type { Asset, Debt, SavingsGoal } from '../../types/database'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

/**
 * Auto-valuation veri erişimi. Yalnızca `auto_valued=true` satırlar çekilir
 * (manuel girişler asla dokunulmaz); RLS sorguları oturum açan kullanıcıya
 * daraltır, açık user filtresi gerekmez. Saf değerleme/orkestrasyon
 * `utils/valuationSync.ts`'te kalır.
 */

export type ValuationTable = 'assets' | 'debts' | 'savings_goals'

export type EstimatedValueUpdate = { id: string; value: number }

export async function fetchAutoValuedAssets(): Promise<Result<Asset[]>> {
  const { data, error } = await supabase.from('assets').select('*').eq('auto_valued', true)
  return resultFromSupabase((data ?? []) as Asset[], error, 'Otomatik değerlenen varlıklar yüklenemedi.')
}

export async function fetchAutoValuedDebts(): Promise<Result<Debt[]>> {
  const { data, error } = await supabase.from('debts').select('*').eq('auto_valued', true).eq('status', 'açık')
  return resultFromSupabase((data ?? []) as Debt[], error, 'Otomatik değerlenen borçlar yüklenemedi.')
}

export async function fetchAutoValuedGoals(): Promise<Result<SavingsGoal[]>> {
  const { data, error } = await supabase.from('savings_goals').select('*').eq('auto_valued', true).eq('status', 'active')
  return resultFromSupabase((data ?? []) as SavingsGoal[], error, 'Otomatik değerlenen hedefler yüklenemedi.')
}

export async function persistEstimatedValues(table: ValuationTable, updates: EstimatedValueUpdate[]): Promise<Result<void>> {
  if (updates.length === 0) return { ok: true, data: undefined }
  const results = await Promise.all(
    updates.map(({ id, value }) =>
      supabase
        .from(table)
        .update({ estimated_value_try: value, updated_at: new Date().toISOString() })
        .eq('id', id),
    ),
  )
  const firstError = results.find((r) => r.error)?.error ?? null
  return voidResultFromSupabase(firstError, 'Tahmini değerler kaydedilemedi.')
}
