import { describe, expect, it } from 'vitest'
import {
  applicationServerKeyMatches,
  pushUnavailableReason,
  shouldSyncPushSubscription,
  urlBase64ToUint8Array,
} from './pushClient'

describe('urlBase64ToUint8Array', () => {
  it('decodes a url-safe base64 VAPID key to the correct bytes', () => {
    // "hello" → base64 "aGVsbG8=" → url-safe without padding "aGVsbG8"
    const result = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111])
  })

  it('handles url-safe chars (- and _) and missing padding', () => {
    // bytes [251, 255, 191] → base64 "+/+/" → url-safe "-_-_"
    const result = urlBase64ToUint8Array('-_-_')
    expect(Array.from(result)).toEqual([251, 255, 191])
  })

  it('produces the 65-byte length typical of a VAPID public key', () => {
    // 65 bytes → 87 base64 chars (url-safe, unpadded). Use a deterministic filler.
    const key = 'B' + 'A'.repeat(86)
    const result = urlBase64ToUint8Array(key)
    expect(result.length).toBe(65)
  })

  it('compares an existing applicationServerKey with the configured VAPID public key', () => {
    const key = urlBase64ToUint8Array('aGVsbG8')
    expect(applicationServerKeyMatches(key.buffer, 'aGVsbG8')).toBe(true)
    expect(applicationServerKeyMatches(key.buffer, 'aGVsbGE')).toBe(false)
  })

  it('treats missing browser key metadata as compatible', () => {
    expect(applicationServerKeyMatches(null, 'aGVsbG8')).toBe(true)
  })
})

describe('shouldSyncPushSubscription', () => {
  const base = { supported: true, configured: true, permission: 'granted' as const, optedOut: false }

  it('runs the silent repair when permission is already granted', () => {
    expect(shouldSyncPushSubscription(base)).toBe('proceed')
  })

  it('never subscribes silently without permission', () => {
    expect(shouldSyncPushSubscription({ ...base, permission: 'default' })).toBe('not-permitted')
    expect(shouldSyncPushSubscription({ ...base, permission: 'denied' })).toBe('not-permitted')
  })

  it('respects an explicit opt-out on this device', () => {
    // Aksi halde kullanıcı bildirimleri kapattığı anda onarım geri açardı.
    expect(shouldSyncPushSubscription({ ...base, optedOut: true })).toBe('opted-out')
  })

  it('skips when push is unsupported or VAPID key is missing', () => {
    expect(shouldSyncPushSubscription({ ...base, supported: false })).toBe('unsupported')
    expect(shouldSyncPushSubscription({ ...base, configured: false })).toBe('unsupported')
  })
})

describe('pushUnavailableReason', () => {
  const ok = { supported: true, configured: true, iosLike: false, standalone: false }

  it('kart kullanilabilirse sebep yok', () => {
    expect(pushUnavailableReason(ok)).toBeNull()
  })

  it('Safari sekmesindeki iPhone icin "ana ekrana ekle" der', () => {
    // iOS'ta PushManager yalnız yüklü PWA'da var; kart eskiden sessizce kayboluyordu.
    expect(pushUnavailableReason({ ...ok, supported: false, iosLike: true })).toBe('ios-needs-install')
  })

  it('ana ekrana eklenmis iOS hala desteklemiyorsa tarayici sebebini verir', () => {
    expect(pushUnavailableReason({ ...ok, supported: false, iosLike: true, standalone: true }))
      .toBe('unsupported-browser')
  })

  it('iOS disi desteksiz tarayiciyi ayirt eder', () => {
    expect(pushUnavailableReason({ ...ok, supported: false })).toBe('unsupported-browser')
  })

  it('destek varken eksik VAPID anahtarini bildirir', () => {
    expect(pushUnavailableReason({ ...ok, configured: false })).toBe('not-configured')
  })
})
