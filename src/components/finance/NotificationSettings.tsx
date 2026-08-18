import { Bell, BellOff, BellRing, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../ui/button'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Select } from '../ui/input'
import {
  currentPushUnavailableReason,
  getCurrentPushEndpoint,
  getPushPermission,
  isSubscribedOnThisDevice,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/pushClient'
import { sendTestPushNotification } from '../../services/pushNotifications'
import {
  fetchLastNotification,
  fetchNotificationPreferences,
  upsertNotificationPreferences,
  type NotificationLogEntry,
} from '../../data/repositories/notificationPreferencesRepo'
import {
  DAILY_PUSH_HOUR,
  DEFAULT_NOTIFICATION_PREFERENCES,
  quietHoursMuteDailyPush,
  type NotificationTypeKey,
} from '../../utils/notificationPreferences'
import { formatDate } from '../../utils/date'

type PrefFlags = {
  payments_enabled: boolean
  loans_enabled: boolean
  statements_enabled: boolean
  weekly_enabled: boolean
  cars_enabled: boolean
  provisions_enabled: boolean
  quiet_hours_start: number | null
  quiet_hours_end: number | null
}

const TYPE_TOGGLES: { key: NotificationTypeKey; label: string; hint: string }[] = [
  { key: 'cars_enabled', label: 'Araç bakım & yenileme', hint: 'Tarihli araç işlerine 7 gün kala' },
  { key: 'payments_enabled', label: 'Ödeme vadeleri', hint: 'Yarın vadesi gelen planlı ödemeler' },
  { key: 'loans_enabled', label: 'Kredi taksitleri', hint: 'Yarın vadesi gelen kredi taksitleri' },
  { key: 'statements_enabled', label: 'Ekstre kesimi', hint: 'Kesime 3 gün kala hatırlatma' },
  { key: 'weekly_enabled', label: 'Haftalık özet & mutabakat', hint: 'Pazartesi özeti ve mutabakat hatırlatması' },
  { key: 'provisions_enabled', label: 'Taksit onayı bekleyen provizyon', hint: 'Otomatik tek çekim kesinleşmeden önce hatırlat' },
]

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  car_reminder_due_7d: 'Araç bakım / yenileme',
  payment_due_tomorrow: 'Ödeme vadesi',
  loan_installment_due_tomorrow: 'Kredi taksiti',
  card_statement_cut_3d: 'Ekstre kesimi',
  weekly_summary: 'Haftalık özet',
  reconciliation_stale_weekly: 'Mutabakat hatırlatması',
  provision_installment_pending: 'Provizyon taksit onayı',
  test: 'Test bildirimi',
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/**
 * "Bildirimler" ayar kartı (roadmap Y1 + v1.1). Bu cihazı Web Push'a abone eder;
 * ayrıca tür bazlı aç/kapa, sessiz saatler ve son gönderim durumunu yönetir.
 * Gönderim zamanlanmış edge fonksiyonu (push-notify) tarafından yapılır ve bu
 * tercihlere uyar.
 */
export function NotificationSettings() {
  const { user } = useAuth()
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [prefs, setPrefs] = useState<PrefFlags>(DEFAULT_NOTIFICATION_PREFERENCES)
  const [lastNotif, setLastNotif] = useState<NotificationLogEntry | null>(null)
  const [savingPref, setSavingPref] = useState(false)

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

  const loadPrefs = useCallback(async () => {
    if (!user) return
    const [prefResult, lastResult] = await Promise.all([fetchNotificationPreferences(), fetchLastNotification()])
    if (prefResult.ok && prefResult.data) {
      const row = prefResult.data
      setPrefs({
        payments_enabled: row.payments_enabled,
        loans_enabled: row.loans_enabled,
        statements_enabled: row.statements_enabled,
        weekly_enabled: row.weekly_enabled,
        cars_enabled: row.cars_enabled,
        // Kolon yeni: migration'dan önceki satırlarda undefined gelebilir.
        provisions_enabled: row.provisions_enabled ?? true,
        quiet_hours_start: row.quiet_hours_start,
        quiet_hours_end: row.quiet_hours_end,
      })
    }
    if (lastResult.ok) setLastNotif(lastResult.data)
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    void loadPrefs()
  }, [refresh, loadPrefs])

  const unavailableReason = currentPushUnavailableReason()
  const permission = getPushPermission()
  const blocked = permission === 'denied'

  const savePrefs = useCallback(async (next: PrefFlags) => {
    if (!user) return
    const previous = prefs
    setPrefs(next)
    setSavingPref(true)
    setError(null)
    const result = await upsertNotificationPreferences(user.id, next)
    setSavingPref(false)
    if (!result.ok) {
      setPrefs(previous)
      setError(result.error.message ?? 'Bildirim tercihleri kaydedilemedi.')
    }
  }, [user, prefs])

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

  // Desteklenmeyen ortamda kartı GİZLEME — sebebini söyle. En sık vaka iPhone:
  // Safari sekmesinde Web Push yoktur, yalnız ana ekrana eklenmiş PWA'da vardır.
  if (unavailableReason) {
    return (
      <SurfaceCard>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BellOff className="h-5 w-5" /> Bildirimler
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unavailableReason === 'ios-needs-install' ? (
            <p className="text-sm text-muted-foreground">
              iPhone/iPad'de bildirimler yalnız <strong>ana ekrana eklenmiş</strong> uygulamada çalışır. Safari'de
              paylaş düğmesi → <strong>Ana Ekrana Ekle</strong> de, sonra uygulamayı ana ekrandaki simgesinden aç —
              bu kart burada açılabilir hâle gelir.
            </p>
          ) : unavailableReason === 'unsupported-browser' ? (
            <p className="text-sm text-muted-foreground">
              Bu tarayıcı Web Push'u desteklemiyor. Chrome, Edge veya ana ekrana eklenmiş uygulama üzerinden dene.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Bildirim anahtarı (VAPID) bu sürümde tanımlı değil, gönderim yapılamaz.
            </p>
          )}
        </CardContent>
      </SurfaceCard>
    )
  }

  const quietOn = prefs.quiet_hours_start != null && prefs.quiet_hours_end != null

  return (
    <SurfaceCard>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bell className="h-5 w-5" /> Bildirimler
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {user ? (
          <div className="space-y-3 border-t border-border/60 pt-3">
            <p className="text-sm font-semibold text-foreground">Hangi bildirimler gelsin?</p>
            <div className="grid gap-2">
              {TYPE_TOGGLES.map(({ key, label, hint }) => {
                const on = prefs[key]
                return (
                  <button
                    key={key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={label}
                    disabled={savingPref}
                    onClick={() => void savePrefs({ ...prefs, [key]: !on })}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left transition hover:bg-muted/40 disabled:opacity-60"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{label}</span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                    <span
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Sessiz saatler</span>
                <input
                  type="checkbox"
                  checked={quietOn}
                  disabled={savingPref}
                  onChange={(e) =>
                    void savePrefs({
                      ...prefs,
                      quiet_hours_start: e.target.checked ? 22 : null,
                      quiet_hours_end: e.target.checked ? 8 : null,
                    })
                  }
                  className="size-4 accent-primary"
                  aria-label="Sessiz saatleri aç"
                />
              </label>
              {quietOn ? (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <Select
                    value={String(prefs.quiet_hours_start ?? 22)}
                    onChange={(e) => void savePrefs({ ...prefs, quiet_hours_start: Number(e.target.value) })}
                    className="w-20"
                    aria-label="Sessiz saat başlangıcı"
                  >
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </Select>
                  <span className="text-muted-foreground">–</span>
                  <Select
                    value={String(prefs.quiet_hours_end ?? 8)}
                    onChange={(e) => void savePrefs({ ...prefs, quiet_hours_end: Number(e.target.value) })}
                    className="w-20"
                    aria-label="Sessiz saat bitişi"
                  >
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </Select>
                  <span className="text-xs text-muted-foreground">arası bildirim gönderilmez.</span>
                </div>
              ) : null}
              {quietOn && quietHoursMuteDailyPush(prefs.quiet_hours_start, prefs.quiet_hours_end) ? (
                <p className="mt-2 text-xs font-medium text-warning">
                  Bildirimler her gün {String(DAILY_PUSH_HOUR).padStart(2, '0')}:00'de gönderiliyor ve bu saat seçtiğin
                  sessiz aralığın içinde — bu haliyle hiçbir bildirim ulaşmaz. Aralığı {String(DAILY_PUSH_HOUR).padStart(2, '0')}:00'i
                  dışarıda bırakacak şekilde daralt.
                </p>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              {lastNotif
                ? `Son gönderilen: ${NOTIFICATION_TYPE_LABELS[lastNotif.notification_type] ?? lastNotif.notification_type} · ${formatDate(lastNotif.sent_at.slice(0, 10))}`
                : 'Henüz bildirim gönderilmedi.'}
            </p>
          </div>
        ) : null}

        {subscribed && !blocked ? (
          <p className="text-xs text-muted-foreground">Bu cihaz bildirimlere abone.</p>
        ) : null}
        {info ? <p className="text-sm text-success">{info}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </CardContent>
    </SurfaceCard>
  )
}
