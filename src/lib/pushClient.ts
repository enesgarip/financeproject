import {
  savePushSubscription,
  deletePushSubscription,
  hasPushSubscription,
  type PushSubscriptionPayload,
} from '../data/repositories/pushSubscriptionsRepo'

/**
 * Web Push istemci akışı (roadmap Y1): service worker kaydı, izin isteme,
 * PushManager aboneliği ve DB'ye kaydetme. VAPID public key env'den gelir
 * (`VITE_VAPID_PUBLIC_KEY`) — gizli değildir, gizli olan private key yalnız
 * gönderici edge fonksiyonundadır (Supabase secret).
 */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Tarayıcı Web Push'u destekliyor mu? */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** VAPID public key tanımlı mı (özellik kurulu mu)? */
export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY)
}

export function getPushPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

/** base64url VAPID anahtarını PushManager'ın beklediği Uint8Array'e çevirir. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

function bufferToBytes(buffer: BufferSource): Uint8Array {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer)
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export function applicationServerKeyMatches(
  applicationServerKey: BufferSource | null,
  expectedPublicKey: string | undefined,
): boolean {
  if (!applicationServerKey || !expectedPublicKey) return true
  const actual = bufferToBytes(applicationServerKey)
  const expected = urlBase64ToUint8Array(expectedPublicKey)
  if (actual.length !== expected.length) return false
  return actual.every((byte, index) => byte === expected[index])
}

/** ArrayBuffer'ı base64url'e çevirir (abonelik anahtarlarını DB'ye yazarken). */
function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return ''
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration()
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

function subscriptionToPayload(subscription: PushSubscription): PushSubscriptionPayload {
  return {
    endpoint: subscription.endpoint,
    p256dh: arrayBufferToBase64Url(subscription.getKey('p256dh')),
    auth: arrayBufferToBase64Url(subscription.getKey('auth')),
  }
}

async function getCompatibleSubscription(
  registration: ServiceWorkerRegistration,
  userId: string,
): Promise<PushSubscription | null> {
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return null

  if (applicationServerKeyMatches(subscription.options.applicationServerKey, VAPID_PUBLIC_KEY)) {
    return subscription
  }

  const staleEndpoint = subscription.endpoint
  await subscription.unsubscribe()
  await deletePushSubscription(userId, staleEndpoint).then(() => undefined, () => undefined)

  if (Notification.permission !== 'granted' || !VAPID_PUBLIC_KEY) return null

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
}

/**
 * İzin ister, push'a abone olur ve DB'ye kaydeder. Başarıda true döner.
 * İzin reddedilirse veya desteklenmiyorsa hata fırlatır (UI yakalar).
 */
export async function subscribeToPush(userId: string): Promise<void> {
  if (!isPushSupported()) throw new Error('Bu tarayıcı bildirimleri desteklemiyor.')
  if (!VAPID_PUBLIC_KEY) throw new Error('Bildirim anahtarı (VAPID) tanımlı değil.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Bildirim izni verilmedi.')

  clearPushOptOut()

  const registration = await ensureRegistration()
  await navigator.serviceWorker.ready

  let subscription = await getCompatibleSubscription(registration, userId)
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const saveResult = await savePushSubscription(userId, subscriptionToPayload(subscription))
  if (!saveResult.ok) throw new Error(saveResult.error.message)
}

/** Aboneliği iptal eder ve DB'den siler. */
export async function unsubscribeFromPush(userId: string): Promise<void> {
  if (!isPushSupported()) return
  // Kapatma niyeti bu cihaza yazılır; yoksa aşağıdaki otomatik onarım
  // aboneliği hemen geri açar ve kullanıcı bildirimleri hiç kapatamaz.
  markPushOptOut()
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  const result = await deletePushSubscription(userId, endpoint)
  if (!result.ok) throw new Error(result.error.message)
}

/**
 * Bu cihaz şu an abone mi? Varsa tarayıcı aboneliğini DB satırıyla da senkronlar;
 * böylece eski/eksik server kaydı yüzünden "açık görünüp gelmeyen" bildirim kalmaz.
 */
export async function isSubscribedOnThisDevice(userId?: string): Promise<boolean> {
  if (!isPushSupported()) return false
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription || !registration) return false
  if (!userId) return true

  const compatibleSubscription = await getCompatibleSubscription(registration, userId)
  if (!compatibleSubscription) return false

  const hasResult = await hasPushSubscription(userId, compatibleSubscription.endpoint)
  const registered = hasResult.ok && hasResult.data
  if (!registered) await savePushSubscription(userId, subscriptionToPayload(compatibleSubscription))
  return true
}

// ── Sessiz abonelik onarımı ────────────────────────────────────────────────
// Push aboneliği kullanıcı hiçbir şey yapmadan ölebilir: tarayıcı endpoint'i
// döndürür, iOS PWA aboneliği düşürür ya da gönderici 410 Gone alıp server
// satırını siler. Bu durumda uygulama "bildirimler açık" görünür ama hiçbir
// şey gelmez. Aşağıdaki senkron her açılışta sessizce durumu tazeler.

const PUSH_OPT_OUT_KEY = 'push:optOut'

function markPushOptOut(): void {
  try {
    localStorage.setItem(PUSH_OPT_OUT_KEY, '1')
  } catch {
    // Depolama yoksa (özel mod) opt-out hatırlanamaz; senkron yine de izne bakar.
  }
}

function clearPushOptOut(): void {
  try {
    localStorage.removeItem(PUSH_OPT_OUT_KEY)
  } catch {
    // yok sayılır
  }
}

/** Kullanıcı bu cihazda bildirimleri kendi kapattı mı? */
export function isPushOptedOut(): boolean {
  try {
    return localStorage.getItem(PUSH_OPT_OUT_KEY) === '1'
  } catch {
    return false
  }
}

export type PushSyncOutcome =
  | 'unsupported'
  | 'not-permitted'
  | 'opted-out'
  | 'no-registration'
  | 'already-registered'
  | 'server-row-restored'
  | 'resubscribed'
  | 'failed'

/**
 * Otomatik onarımın koşabileceği durum mu? Saf karar (test edilebilir):
 * izin verilmemişse asla sessizce abone olma, kullanıcı kapattıysa dokunma.
 */
export function shouldSyncPushSubscription(input: {
  supported: boolean
  configured: boolean
  permission: NotificationPermission | 'unsupported'
  optedOut: boolean
}): Exclude<PushSyncOutcome, 'no-registration' | 'already-registered' | 'server-row-restored' | 'resubscribed' | 'failed'> | 'proceed' {
  if (!input.supported || !input.configured) return 'unsupported'
  if (input.optedOut) return 'opted-out'
  if (input.permission !== 'granted') return 'not-permitted'
  return 'proceed'
}

/**
 * İzin zaten verilmişken tarayıcı aboneliğini ve server satırını tazeler.
 * Yeni izin İSTEMEZ; kullanıcı kapattıysa hiç dokunmaz. Hata fırlatmaz —
 * açılış yolunda sessizce çalışır.
 */
export async function syncPushSubscription(userId: string): Promise<PushSyncOutcome> {
  const decision = shouldSyncPushSubscription({
    supported: isPushSupported(),
    configured: isPushConfigured(),
    permission: getPushPermission(),
    optedOut: isPushOptedOut(),
  })
  if (decision !== 'proceed') return decision

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return 'no-registration'

    const existing = await getCompatibleSubscription(registration, userId)
    if (existing) {
      const hasResult = await hasPushSubscription(userId, existing.endpoint)
      if (hasResult.ok && hasResult.data) return 'already-registered'
      const saved = await savePushSubscription(userId, subscriptionToPayload(existing))
      return saved.ok ? 'server-row-restored' : 'failed'
    }

    // Tarayıcı aboneliği tamamen düşmüş: izin hâlâ verili olduğu için
    // kullanıcı hareketi gerekmeden yeniden abone olunabilir.
    const revived = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string),
    })
    const saved = await savePushSubscription(userId, subscriptionToPayload(revived))
    return saved.ok ? 'resubscribed' : 'failed'
  } catch {
    return 'failed'
  }
}

// ── "Kart neden yok?" ──────────────────────────────────────────────────────
// Bildirim kartı desteklenmeyen ortamda sessizce KAYBOLUYORDU. En sık vakası
// iPhone: Safari sekmesinde `PushManager` yoktur, yalnız ana ekrana eklenmiş
// PWA'da vardır — kullanıcı da kartı bulamadığı için özelliğin bozuk mu yoksa
// yanlış yerde mi olduğunu anlayamıyordu. Artık sebep gösteriliyor.

export type PushUnavailableReason = 'ios-needs-install' | 'unsupported-browser' | 'not-configured' | null

/** Kartın neden kullanılamadığını söyler; null = kullanılabilir. Saf. */
export function pushUnavailableReason(input: {
  supported: boolean
  configured: boolean
  iosLike: boolean
  standalone: boolean
}): PushUnavailableReason {
  if (!input.supported) {
    return input.iosLike && !input.standalone ? 'ios-needs-install' : 'unsupported-browser'
  }
  if (!input.configured) return 'not-configured'
  return null
}

/** iOS/iPadOS mu? (iPad'ler masaüstü user-agent bildirebiliyor.) */
export function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** Uygulama ana ekrandan (standalone PWA olarak) mı açıldı? */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function currentPushUnavailableReason(): PushUnavailableReason {
  return pushUnavailableReason({
    supported: isPushSupported(),
    configured: isPushConfigured(),
    iosLike: isIosLike(),
    standalone: isStandaloneDisplay(),
  })
}

export async function getCurrentPushEndpoint(): Promise<string | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}
