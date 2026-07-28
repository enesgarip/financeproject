import { supabase } from '../../lib/supabase'
import type { NotificationPreferences } from '../../types/database'
import { appErrorFromSupabase, fail, ok, type Result } from '../result'

export type NotificationLogEntry = {
  notification_type: string
  sent_at: string
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
