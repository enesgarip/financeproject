/**
 * Sentry'siz istemci hata izleme (mühendislik turu ②).
 *
 * Üretim telefon PWA'sında konsola erişim yok; Sentry bilinçli kaldırıldığından
 * (DSN üretimde hiç tanımlı değildi) çökmeler tamamen görünmezdi. Bu modül
 * hataları kullanıcının KENDİ Supabase'ine yazar (client_errors, own-row RLS)
 * — CSP değişikliği gerekmez, Supabase origin'i zaten izinli.
 *
 * Şişme korumaları (çökme döngüsü tabloyu dolduramaz):
 *  - oturum başına en fazla SESSION_CAP kayıt,
 *  - aynı hata (hash) oturumda bir, localStorage ile günde bir,
 *  - raporlama hatası ASLA uygulamaya sızmaz (her yol try/catch).
 *
 * Giriş yapılmadan oluşan hata RLS'e takılır ve sessizce düşer — kabul: login
 * ekranının kendisi zaten tek sayfalık, asıl körlük oturum İÇİ çökmelerdeydi.
 */
import { supabase } from './supabase'
import { sha256Hex } from '../utils/sourceEventId'

type ClientErrorSource = 'boundary' | 'error' | 'unhandledrejection'

const SESSION_CAP = 5
const RETENTION_DAYS = 90

let reportedCount = 0
const seenFingerprints = new Set<string>()

function dayKey(): string {
  return new Date().toLocaleDateString('sv-SE')
}

async function report(source: ClientErrorSource, rawMessage: unknown, stack?: string | null): Promise<void> {
  try {
    if (reportedCount >= SESSION_CAP) return
    const message = (typeof rawMessage === 'string' && rawMessage ? rawMessage : String(rawMessage ?? 'Bilinmeyen hata')).slice(0, 500)
    const fingerprint = await sha256Hex(`${source}:${message}`)
    if (seenFingerprints.has(fingerprint)) return

    const storageKey = `client-error:${fingerprint}:${dayKey()}`
    try {
      if (localStorage.getItem(storageKey)) return
      localStorage.setItem(storageKey, '1')
    } catch {
      /* gizli mod / depolama kapalı — yalnız oturum-içi dedupe kalır */
    }

    seenFingerprints.add(fingerprint)
    reportedCount += 1

    await supabase.from('client_errors').insert({
      source,
      message,
      stack: stack ? stack.slice(0, 4000) : null,
      route: window.location.pathname,
      commit_sha: __APP_COMMIT__,
      user_agent: navigator.userAgent.slice(0, 300),
      fingerprint,
    })
  } catch {
    /* hata raporlama asla uygulamayı bozmaz */
  }
}

/** AppErrorBoundary.componentDidCatch → buraya (dinamik import ile — entry şişmez). */
export function reportBoundaryError(error: Error, componentStack?: string | null): void {
  void report('boundary', error.message, `${error.stack ?? ''}\n${componentStack ?? ''}`.trim())
}

let installed = false

/** window dinleyicileri + oturumda bir kez 90 gün retention (en-iyi-çaba). */
export function installClientErrorReporting(): void {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    void report('error', event.message, event.error instanceof Error ? event.error.stack : null)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    if (reason instanceof Error) void report('unhandledrejection', reason.message, reason.stack)
    else void report('unhandledrejection', reason)
  })

  void supabase
    .from('client_errors')
    .delete()
    .lt('created_at', new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString())
    .then(() => undefined, () => undefined)
}
