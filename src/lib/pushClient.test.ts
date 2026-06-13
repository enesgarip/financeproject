import { describe, expect, it } from 'vitest'
import { urlBase64ToUint8Array } from './pushClient'

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
})
