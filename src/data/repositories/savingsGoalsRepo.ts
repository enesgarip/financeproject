import { supabase } from '../../lib/supabase'
import type { InsertFor, SavingsGoal, SavingsGoalComponent, SavingsGoalSource } from '../../types/database'
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
  sources: SavingsGoalSource[]
  componentsError: AppError | null
  sourcesError: AppError | null
}

export type SavingsGoalFields = Omit<InsertFor<'savings_goals'>, 'user_id' | 'id' | 'created_at' | 'updated_at'>

/**
 * RPC'ye gönderilen kaynak satırı. Yeni bileşenlerin henüz id'si olmadığı için
 * bileşen bağı SIRA NUMARASIYLA taşınır; RPC bunu yazdığı bileşenin id'sine
 * çevirir. `component_index === null` → hedefin kendisine bağlı.
 */
export type SavingsGoalSourceInput = {
  component_index: number | null
  kind: SavingsGoalSource['kind']
  asset_id?: string | null
  asset_category?: string | null
  card_id?: string | null
  bucket_id?: string | null
  sort_order?: number
}

/** RPC'ye gönderilen bileşen; `id` varsa satır korunur (bağlı kaynağı yaşasın). */
export type SavingsGoalComponentInput = {
  id?: string | null
  label: string | null
  value_type: SavingsGoalComponent['value_type']
  target_amount: number
  current_amount: number
  sort_order: number
}

export async function fetchSavingsGoalsRows(): Promise<Result<SavingsGoalsRows>> {
  const [goalsResult, componentsResult, sourcesResult] = await Promise.all([
    supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
    supabase.from('savings_goal_components').select('*').order('sort_order', { ascending: true }),
    supabase.from('savings_goal_sources').select('*').order('sort_order', { ascending: true }),
  ])

  if (goalsResult.error) return fail(appErrorFromSupabase(goalsResult.error, 'Birikim hedefleri yüklenemedi.'))

  return ok({
    goals: (goalsResult.data ?? []) as SavingsGoal[],
    components: (componentsResult.data ?? []) as SavingsGoalComponent[],
    sources: (sourcesResult.data ?? []) as SavingsGoalSource[],
    componentsError: componentsResult.error
      ? appErrorFromSupabase(componentsResult.error, 'Hedef bileşenleri yüklenemedi.')
      : null,
    sourcesError: sourcesResult.error
      ? appErrorFromSupabase(sourcesResult.error, 'Hedef takip kaynakları yüklenemedi.')
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
  components: SavingsGoalComponentInput[]
  sources: SavingsGoalSourceInput[]
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
          id: c.id ?? null,
          label: c.label,
          value_type: c.value_type,
          target_amount: c.target_amount,
          current_amount: c.current_amount,
          sort_order: c.sort_order,
        }))
      : [],
    p_sources: input.sources.map((source, index) => ({
      component_index: input.isComposite ? source.component_index : null,
      kind: source.kind,
      asset_id: source.asset_id ?? null,
      asset_category: source.asset_category ?? null,
      card_id: source.card_id ?? null,
      bucket_id: source.bucket_id ?? null,
      sort_order: source.sort_order ?? index,
    })),
  })

  if (error) return voidResultFromSupabase(error, 'Hedef kaydedilemedi.')
  if (!data) return fail({ type: 'unknown', message: 'Hedef kimliği oluşturulamadı.' })

  return resultFromSupabase(undefined, null)
}
