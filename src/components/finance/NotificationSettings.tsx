import { Bell, BellOff, BellRing } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../ui/button'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import {
  getPushPermission,
  isPushConfigured,
  isPushSupported,
  isSubscribedOnThisDevice,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/pushClient'

/**
 * "Bildirimler" ayar kartı (roadmap Y1). Bu cihazı Web Push'a abone eder/çıkarır.
 * Gönderim zamanlanmış edge fonksiyonu (push-notify) tarafından yapılır.
 */
export function NotificationSettings() {
  const { user } = useAuth()
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  const refresh = useCallback(async () => {
    setSubscribed(await isSubscribedOnThisDevice())
    setChecked(true)
  }, [])

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
    try {
      if (subscribed) {
        await unsubscribeFromPush(user.id)
      } else {
        await subscribeToPush(user.id)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bir hata oluştu.')
    } finally {
      setBusy(false)
    }
  }, [user, subscribed, refresh])

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
          <Button onClick={toggle} disabled={busy || !checked} variant={subscribed ? 'outline' : 'default'}>
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
        )}

        {subscribed && !blocked ? (
          <p className="text-xs text-muted-foreground">Bu cihaz bildirimlere abone.</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </SurfaceCard>
  )
}
