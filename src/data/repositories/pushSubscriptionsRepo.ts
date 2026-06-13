import { supabase } from '../../lib/supabase'

/**
 * Web Push aboneliklerinin veri erişimi (roadmap Y1). Tarayıcı izin/abonelik
 * mantığı `lib/pushClient.ts`'te; bu dosya yalnız DB I/O.
 */

export type PushSubscriptionPayload = {
  endpoint: string
  p256dh: string
  auth: string
}

/** Cihazın aboneliğini kaydeder/günceller (user_id, endpoint benzersiz → upsert). */
export async function savePushSubscription(
  userId: string,
  sub: PushSubscriptionPayload,
): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      } as never,
      { onConflict: 'user_id,endpoint' },
    )
  if (error) throw error
}

/** Bir cihazın aboneliğini siler (kullanıcı bildirimi kapatınca). */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
  if (error) throw error
}

/** Bu kullanıcının bu cihaz için kayıtlı aboneliği var mı? */
export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}
