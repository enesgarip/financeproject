import { describe, expect, it } from 'vitest'
import {
  areStockPricesStale,
  normalizeTicker,
  STOCK_PRICES_MAX_AGE_HOURS,
  stockPricesAgeHours,
  type StockPricesSnapshot,
} from './stockQuotesClient'

/**
 * Hisse fiyat cache'inin YAŞ kavramı (Faz F). Bulgu: kur tarafında
 * `marketRates.isSnapshotStale` varken burada karşılığı yoktu — kaynak günlerce
 * erişilemez olsa bile cache'teki fiyat "geçerli" sayılıyor ve `valuationSync`
 * onu `estimated_value_try`'a kalıcı yazıyordu.
 *
 * `fetchStockPrices` localStorage + edge fonksiyonu gerektirir (node ortamında
 * yok); burada kararı VEREN saf yardımcılar kilitlenir.
 */
const NOW = new Date('2026-08-12T12:00:00.000Z')

function snapshot(fetchedAt: string, asOf: string | null = null): StockPricesSnapshot {
  return { prices: { THYAO: 300 }, asOf, fetchedAt }
}

describe('stockPricesAgeHours', () => {
  it('cache ALINDIĞI andan bu yana geçen saati verir', () => {
    expect(stockPricesAgeHours(snapshot('2026-08-12T09:00:00.000Z'), NOW)).toBe(3)
    expect(stockPricesAgeHours(snapshot('2026-08-10T12:00:00.000Z'), NOW)).toBe(48)
  })

  it('okunamayan/eksik zaman damgasında null döner', () => {
    expect(stockPricesAgeHours(null, NOW)).toBeNull()
    expect(stockPricesAgeHours(snapshot('bugün'), NOW)).toBeNull()
  })

  it('yaşı asOf DEĞİL fetchedAt belirler', () => {
    // asOf son SEANS kapanışıdır: borsa hafta sonu kapalıyken normal olarak 24
    // saati aşar. Onu ölçmek sağlıklı veriyi bayat sayardı — ölçtüğümüz şey
    // "kaynakla en son ne zaman konuşabildik".
    const weekend = snapshot('2026-08-12T11:00:00.000Z', '2026-08-07T15:00:00.000Z')
    expect(stockPricesAgeHours(weekend, NOW)).toBe(1)
    expect(areStockPricesStale(weekend, STOCK_PRICES_MAX_AGE_HOURS, NOW)).toBe(false)
  })
})

describe('areStockPricesStale', () => {
  it('eşiğin altındaki cache tazedir, üstündeki bayat', () => {
    expect(areStockPricesStale(snapshot('2026-08-11T13:00:00.000Z'), 24, NOW)).toBe(false)
    expect(areStockPricesStale(snapshot('2026-08-11T11:00:00.000Z'), 24, NOW)).toBe(true)
  })

  it('cache yoksa ya da yaşı bilinmiyorsa BAYAT sayar (körlemesine güvenme)', () => {
    expect(areStockPricesStale(null, 24, NOW)).toBe(true)
    expect(areStockPricesStale(snapshot('bugün'), 24, NOW)).toBe(true)
  })

  it('varsayılan eşik 24 saattir', () => {
    expect(STOCK_PRICES_MAX_AGE_HOURS).toBe(24)
    expect(areStockPricesStale(snapshot('2026-08-10T12:00:00.000Z'), undefined, NOW)).toBe(true)
  })
})

describe('normalizeTicker', () => {
  it('.IS uzantısını atar ve büyük harfe çeker', () => {
    expect(normalizeTicker('thyao.IS')).toBe('THYAO')
  })

  it('geçersiz sembolde null döner', () => {
    expect(normalizeTicker('')).toBeNull()
    expect(normalizeTicker('THY AO')).toBeNull()
  })
})
