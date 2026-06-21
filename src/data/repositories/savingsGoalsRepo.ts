import { supabase } from '../../lib/supabase'
import type { InsertFor, SavingsGoal, SavingsGoalComponent, UpdateFor } from '../../types/database'
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
  let goalId = input.editingGoal?.id

  if (input.editingGoal) {
    const { error } = await supabase
      .from('savings_goals')
      .update({ ...input.goalFields, updated_at: new Date().toISOString() } satisfies UpdateFor<'savings_goals'>)
      .eq('id', input.editingGoal.id)
    if (error) return voidResultFromSupabase(error, 'Hedef kaydedilemedi.')
  } else {
    const { data, error } = await supabase
      .from('savings_goals')
      .insert({ user_id: input.userId, ...input.goalFields } satisfies InsertFor<'savings_goals'>)
      .select('id')
      .single()
    if (error) return voidResultFromSupabase(error, 'Hedef kaydedilemedi.')
    if (!data) return fail({ type: 'unknown', message: 'Hedef kimliği oluşturulamadı.' })
    goalId = data.id
  }

  if (!goalId) return fail({ type: 'unknown', message: 'Hedef kimliği oluşturulamadı.' })

  if (input.isComposite) {
    const deleteResult = await supabase.from('savings_goal_components').delete().eq('goal_id', goalId)
    if (deleteResult.error) return voidResultFromSupabase(deleteResult.error, 'Hedef bileşenleri temizlenemedi.')

    const insertResult = await supabase.from('savings_goal_components').insert(
      input.components.map((row) => ({ ...row, goal_id: goalId })),
    )
    return voidResultFromSupabase(insertResult.error, 'Hedef bileşenleri kaydedilemedi.')
  }

  if (input.editingGoal?.value_type === 'composite') {
    const { error } = await supabase.from('savings_goal_components').delete().eq('goal_id', goalId)
    return voidResultFromSupabase(error, 'Hedef bileşenleri temizlenemedi.')
  }

  return resultFromSupabase(undefined, null)
}
