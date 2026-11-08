import { describe, expect, it } from 'vitest'
import { suggestNextCarService } from './carServicePlan'

describe('gerçekleşen bakımdan sonraki plan', () => {
  it('ay sonunu güvenli kısaltır ve kilometre aralığını gerçekleşenden başlatır', () => {
    expect(suggestNextCarService({ repeat_months: 1, repeat_km: 10000 }, '2026-01-31', 51000)).toEqual({ nextDate: '2026-02-28', nextKm: 61000 })
  })
  it('eksik kilometrede mesafe veya tekrar yokken tarih uydurmaz', () => {
    expect(suggestNextCarService({ repeat_months: null, repeat_km: 5000 }, '2026-11-08', null)).toEqual({ nextDate: null, nextKm: null })
  })
})
