import { supabase } from '../lib/supabase'

export type PushTestResult = {
  ok: boolean
  mode: 'test'
  sent: number
  deviceDeliveries: number
  staleDeleted: number
  failed: number
  reason?: 'no_subscription' | 'delivery_failed'
}

function readReasonMessage(result: PushTestResult): string {
  if (result.reason === 'no_subscription') {
    return 'Bu cihaz için kayıtlı bildirim aboneliği bulunamadı. Bildirimleri kapatıp tekrar açmayı dene.'
  }
  if (result.reason === 'delivery_failed') {
    return 'Test bildirimi gönderilemedi. VAPID anahtarları veya push servisi tarafında hata olabilir.'
  }
  return 'Test bildirimi gönderilemedi.'
}

export async function sendTestPushNotification(endpoint: string | null): Promise<PushTestResult> {
  const { data, error } = await supabase.functions.invoke('push-notify', {
    body: {
      mode: 'test',
      endpoint,
    },
  })

  if (error) throw new Error(error.message || 'Test bildirimi gönderilemedi.')
  if (!data || typeof data !== 'object') throw new Error('Test bildirimi yanıtı okunamadı.')

  const result = data as PushTestResult
  if (!result.ok) throw new Error(readReasonMessage(result))
  return result
}
