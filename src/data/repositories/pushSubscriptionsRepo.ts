import { supabase } from '../../lib/supabase'
import { resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

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
): Promise<Result<void>> {
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
  return voidResultFromSupabase(error, 'Push aboneliği kaydedilemedi.')
}

/** Bir cihazın aboneliğini siler (kullanıcı bildirimi kapatınca). */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<Result<void>> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
  return voidResultFromSupabase(error, 'Push aboneliği silinemedi.')
}

/** Bu kullanıcının bu cihaz için kayıtlı aboneliği var mı? */
export async function hasPushSubscription(userId: string, endpoint: string): Promise<Result<boolean>> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .maybeSingle()
  return resultFromSupabase(Boolean(data), error, 'Push abonelik durumu sorgulanamadı.')
}
