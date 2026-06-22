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

export async function getCurrentPushEndpoint(): Promise<string | null> {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}
