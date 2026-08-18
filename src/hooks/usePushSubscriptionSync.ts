import { useEffect } from 'react'
import { syncPushSubscription } from '../lib/pushClient'

/**
 * Açılışta push aboneliğini sessizce tazeler.
 *
 * Neden gerekli: abonelik kullanıcı hiçbir şey yapmadan ölebiliyor (tarayıcı
 * endpoint'i döndürür, iOS PWA aboneliği düşürür, gönderici 410 Gone alınca
 * server satırını siler). Onarım şimdiye kadar yalnız Bildirim Ayarları paneli
 * açıldığında çalıştığı için, paneli açmayan cihaz sessizce bildirim almayı
 * kesiyordu. Bu kanca aynı onarımı her oturumda bir kez koşturur.
 *
 * Yeni izin istemez ve kullanıcı bildirimleri bu cihazda kapattıysa dokunmaz.
 */
export function usePushSubscriptionSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const outcome = await syncPushSubscription(userId)
      if (cancelled) return
      if (outcome === 'resubscribed' || outcome === 'server-row-restored') {
        console.info(`[push] abonelik onarıldı: ${outcome}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])
}
