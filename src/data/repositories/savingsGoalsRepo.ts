import { supabase } from '../../lib/supabase'
import type { InsertFor, SavingsGoal, SavingsGoalComponent } from '../../types/database'
import {
  appErrorFromSupabase,
  fail,
  ok,
  resultFromSupabase,
  voidResultFromSupabase,
  type AppError,
  type Result,
} from '../result'

export type SavingsGoalsRows = {
  goals: SavingsGoal[]
  components: SavingsGoalComponent[]
  componentsError: AppError | null
}

export type SavingsGoalFields = Omit<InsertFor<'savings_goals'>, 'user_id' | 'id' | 'created_at' | 'updated_at'>

export async function fetchSavingsGoalsRows(): Promise<Result<SavingsGoalsRows>> {
  const [goalsResult, componentsResult] = await Promise.all([
    supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
    supabase.from('savings_goal_components').select('*').order('sort_order', { ascending: true }),
  ])

  if (goalsResult.error) return fail(appErrorFromSupabase(goalsResult.error, 'Birikim hedefleri yüklenemedi.'))

  return ok({
    goals: (goalsResult.data ?? []) as SavingsGoal[],
    components: (componentsResult.data ?? []) as SavingsGoalComponent[],
    componentsError: componentsResult.error
      ? appErrorFromSupabase(componentsResult.error, 'Hedef bileşenleri yüklenemedi.')
      : null,
  })
}

export async function deleteSavingsGoal(goalId: string): Promise<Result<void>> {
  const { error } = await supabase.from('savings_goals').delete().eq('id', goalId)
  return voidResultFromSupabase(error, 'Hedef silinemedi.')
}

export async function upsertSavingsGoalWithComponents(input: {
  userId: string
  editingGoal: SavingsGoal | null
  goalFields: SavingsGoalFields
  components: InsertFor<'savings_goal_components'>[]
  isComposite: boolean
}): Promise<Result<void>> {
  const { data, error } = await supabase.rpc('upsert_savings_goal', {
    p_goal_id: input.editingGoal?.id ?? null,
    p_name: input.goalFields.name,
    p_value_type: input.goalFields.value_type,
    p_target_amount: input.goalFields.target_amount,
    p_current_amount: input.goalFields.current_amount,
    p_estimated_value_try: input.goalFields.estimated_value_try ?? null,
    p_auto_valued: input.goalFields.auto_valued,
    p_target_date: input.goalFields.target_date ?? null,
    p_status: input.goalFields.status,
    p_note: input.goalFields.note ?? null,
    p_is_composite: input.isComposite,
    p_components: input.isComposite
      ? input.components.map((c) => ({
          label: c.label,
          value_type: c.value_type,
          target_amount: c.target_amount,
          current_amount: c.current_amount,
          sort_order: c.sort_order ?? 0,
        }))
      : [],
  })

  if (error) return voidResultFromSupabase(error, 'Hedef kaydedilemedi.')
  if (!data) return fail({ type: 'unknown', message: 'Hedef kimliği oluşturulamadı.' })

  return resultFromSupabase(undefined, null)
}
