import { Bell, BellOff, BellRing, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../ui/button'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import {
  getCurrentPushEndpoint,
  getPushPermission,
  isPushConfigured,
  isPushSupported,
  isSubscribedOnThisDevice,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/pushClient'
import { sendTestPushNotification } from '../../services/pushNotifications'

/**
 * "Bildirimler" ayar kartı (roadmap Y1). Bu cihazı Web Push'a abone eder/çıkarır.
 * Gönderim zamanlanmış edge fonksiyonu (push-notify) tarafından yapılır.
 */
export function NotificationSettings() {
  const { user } = useAuth()
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setSubscribed(false)
      setChecked(true)
      return
    }

    try {
      setSubscribed(await isSubscribedOnThisDevice(user.id))
    } catch (e) {
      setSubscribed(false)
      setError(e instanceof Error ? e.message : 'Bildirim aboneliği kontrol edilemedi.')
    } finally {
      setChecked(true)
    }
  }, [user])

  useEffect(() => {
    // Async mount kontrolü (tarayıcı abonelik durumunu okur); setState await sonrası.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const supported = isPushSupported()
  const configured = isPushConfigured()
  const permission = getPushPermission()
  const blocked = permission === 'denied'

  const toggle = useCallback(async () => {
    if (!user) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (subscribed) {
        await unsubscribeFromPush(user.id)
        setInfo('Bu cihazda bildirimler kapatıldı.')
      } else {
        await subscribeToPush(user.id)
        setInfo('Bu cihaz bildirimlere abone edildi. Test bildirimi gönderebilirsin.')
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bir hata oluştu.')
    } finally {
      setBusy(false)
    }
  }, [user, subscribed, refresh])

  const sendTest = useCallback(async () => {
    if (!user) return
    setTesting(true)
    setError(null)
    setInfo(null)

    try {
      const synced = await isSubscribedOnThisDevice(user.id)
      setSubscribed(synced)
      if (!synced) throw new Error('Önce bu cihazda bildirimleri açmalısın.')

      const result = await sendTestPushNotification(await getCurrentPushEndpoint())
      setInfo(
        result.deviceDeliveries > 1
          ? `Test bildirimi gönderildi (${result.deviceDeliveries} cihaz teslimi).`
          : 'Test bildirimi gönderildi. Birkaç saniye içinde görünmeli.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test bildirimi gönderilemedi.')
    } finally {
      setTesting(false)
    }
  }, [user])

  // VAPID anahtarı kurulmadıysa veya tarayıcı desteklemiyorsa kartı gizle.
  if (!supported || !configured) return null

  return (
    <SurfaceCard>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-5 w-5" /> Bildirimler
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ekstre kesim tarihi, yaklaşan ödeme günleri ve haftalık özet için bu cihaza
          bildirim gönderilsin. İstediğin zaman kapatabilirsin.
        </p>

        {blocked ? (
          <p className="flex items-center gap-2 text-sm text-amber-600">
            <BellOff className="h-4 w-4" /> Bildirim izni tarayıcıda engellenmiş. Site
            ayarlarından izni açman gerekiyor.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={toggle} disabled={busy || testing || !checked} variant={subscribed ? 'outline' : 'default'}>
              {subscribed ? (
                <>
                  <BellOff className="mr-2 h-4 w-4" /> Bu cihazda bildirimleri kapat
                </>
              ) : (
                <>
                  <BellRing className="mr-2 h-4 w-4" /> Bu cihazda bildirimleri aç
                </>
              )}
            </Button>
            {subscribed ? (
              <Button onClick={() => void sendTest()} disabled={busy || testing || !checked} variant="secondary">
                <Send className="mr-2 h-4 w-4" />
                {testing ? 'Test gönderiliyor...' : 'Test bildirimi gönder'}
              </Button>
            ) : null}
          </div>
        )}

        {subscribed && !blocked ? (
          <p className="text-xs text-muted-foreground">Bu cihaz bildirimlere abone.</p>
        ) : null}
        {info ? <p className="text-sm text-success">{info}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </SurfaceCard>
  )
}
