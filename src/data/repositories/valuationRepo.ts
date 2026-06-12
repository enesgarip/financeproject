import { supabase } from '../../lib/supabase'
import type { Asset, Debt, SavingsGoal } from '../../types/database'

/**
 * Auto-valuation veri erişimi. Yalnızca `auto_valued=true` satırlar çekilir
 * (manuel girişler asla dokunulmaz); RLS sorguları oturum açan kullanıcıya
 * daraltır, açık user filtresi gerekmez. Saf değerleme/orkestrasyon
 * `utils/valuationSync.ts`'te kalır.
 */

export type ValuationTable = 'assets' | 'debts' | 'savings_goals'

export type EstimatedValueUpdate = { id: string; value: number }

export async function fetchAutoValuedAssets(): Promise<Asset[]> {
  const { data, error } = await supabase.from('assets').select('*').eq('auto_valued', true)
  if (error || !data) return []
  return data as Asset[]
}

export async function fetchAutoValuedDebts(): Promise<Debt[]> {
  const { data, error } = await supabase.from('debts').select('*').eq('auto_valued', true).eq('status', 'açık')
  if (error || !data) return []
  return data as Debt[]
}

export async function fetchAutoValuedGoals(): Promise<SavingsGoal[]> {
  const { data, error } = await supabase.from('savings_goals').select('*').eq('auto_valued', true).eq('status', 'active')
  if (error || !data) return []
  return data as SavingsGoal[]
}

export async function persistEstimatedValues(table: ValuationTable, updates: EstimatedValueUpdate[]): Promise<void> {
  if (updates.length === 0) return
  await Promise.all(
    updates.map(({ id, value }) =>
      supabase
        .from(table)
        .update({ estimated_value_try: value, updated_at: new Date().toISOString() })
        .eq('id', id),
    ),
  )
}
