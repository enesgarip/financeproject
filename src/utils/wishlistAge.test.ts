import { describe, expect, it } from 'vitest'
import { buildWishlistAge, WISHLIST_WAIT_DAYS } from './wishlistAge'

const TODAY = new Date(2026, 7, 26) // 26 Ağustos 2026

function item(overrides: Partial<{ created_at: string; purchased_at: string | null; is_purchased: boolean }> = {}) {
  return { created_at: '2026-08-01T10:30:00+03:00', purchased_at: null, is_purchased: false, ...overrides }
}

describe('buildWishlistAge', () => {
  it('counts whole days from a timestamptz created_at', () => {
    // 1 Ağu → 26 Ağu = 25 gün; saat kısmı (10:30) günü oynatmamalı.
    expect(buildWishlistAge(item(), TODAY)).toMatchObject({ ageDays: 25, isStale: false, decisionDays: null })
  })

  it('flips isStale exactly at the 30-day boundary', () => {
    const at29 = buildWishlistAge(item({ created_at: '2026-07-28T00:00:00+03:00' }), TODAY) // 29 gün
    const at30 = buildWishlistAge(item({ created_at: '2026-07-27T23:59:00+03:00' }), TODAY) // 30 gün
    expect(at29).toMatchObject({ ageDays: 29, isStale: false })
    expect(at30).toMatchObject({ ageDays: 30, isStale: true })
    expect(WISHLIST_WAIT_DAYS).toBe(30)
  })

  it('a purchased item is never stale and reports decision days', () => {
    const result = buildWishlistAge(
      item({ created_at: '2026-06-01T09:00:00+03:00', is_purchased: true, purchased_at: '2026-06-13T21:15:00+03:00' }),
      TODAY,
    )
    expect(result).toMatchObject({ isStale: false, decisionDays: 12 })
  })

  it('same-day purchase reports 0 decision days, future clock skew clamps to 0', () => {
    const sameDay = buildWishlistAge(
      item({ created_at: '2026-08-20T09:00:00+03:00', is_purchased: true, purchased_at: '2026-08-20T18:00:00+03:00' }),
      TODAY,
    )
    expect(sameDay.decisionDays).toBe(0)
    // created_at "gelecekte" görünürse (saat kayması) yaş negatife düşmez.
    const skewed = buildWishlistAge(item({ created_at: '2026-08-27T00:10:00+03:00' }), TODAY)
    expect(skewed.ageDays).toBe(0)
  })
})
