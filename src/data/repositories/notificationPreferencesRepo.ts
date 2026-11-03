import { supabase } from '../../lib/supabase'
import type { NotificationPreferences } from '../../types/database'
import { appErrorFromSupabase, fail, ok, type Result } from '../result'

export type NotificationLogEntry = {
  notification_type: string
  sent_at: string
}

export type AutomationHealth = {
  maintenance: { ran_at: string; ok: boolean; errors: number; last_success_at: string | null } | null
  scheduler: { last_dispatched_at: string | null; last_response_at: string | null; last_http_status: number | null; last_success_at: string | null; stale: boolean } | null
  unknown_deliveries: number
  retry_deliveries: number
  failed_deliveries: number
}

export async function fetchAutomationHealth(): Promise<Result<AutomationHealth>> {
  const { data, error } = await supabase.rpc('fetch_automation_health')
  if (error) return fail(appErrorFromSupabase(error, 'Otomasyon durumu okunamadı.'))
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('unknown_deliveries' in data)) return fail({ type: 'unknown', message: 'Otomasyon durumu doğrulanamadı.' })
  return ok(data as AutomationHealth)
}

export async function fetchNotificationPreferences(): Promise<Result<NotificationPreferences | null>> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .maybeSingle()

  if (error) return fail(appErrorFromSupabase(error, 'Bildirim tercihleri yüklenemedi.'))
  return ok((data ?? null) as NotificationPreferences | null)
}

export type NotificationPreferenceFields = Omit<NotificationPreferences, 'user_id' | 'created_at' | 'updated_at'>

export async function upsertNotificationPreferences(
  userId: string,
  fields: NotificationPreferenceFields,
): Promise<Result<NotificationPreferences>> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, ...fields }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return fail(appErrorFromSupabase(error, 'Bildirim tercihleri kaydedilemedi.'))
  return ok(data as NotificationPreferences)
}

export async function fetchLastNotification(): Promise<Result<NotificationLogEntry | null>> {
  const { data, error } = await supabase
    .from('notification_log')
    .select('notification_type, sent_at')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return fail(appErrorFromSupabase(error, 'Son bildirim durumu okunamadı.'))
  return ok((data ?? null) as NotificationLogEntry | null)
}
