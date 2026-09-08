import { supabase } from './supabase'

/**
 * Live BIST equity prices (ticker → TRY), fetched through the `bist-quote`
 * Supabase edge function (which proxies Yahoo Finance, bypassing browser CORS).
 *
 * Like market rates, the latest prices are mirrored to localStorage so holdings
 * keep their last-known value instantly on load and when the source is
 * unreachable. A missing price means "unavailable" — callers fall back to the
 * stored/manual value, so the app never breaks if Yahoo changes or the edge
 * function isn't deployed yet.
 */

export type StockPrices = Record<string, number>

export type StockPricesSnapshot = {
  prices: StockPrices
  asOf: string | null
  fetchedAt: string
}

const STORAGE_KEY = 'fp.stockPrices.v1'

/**
 * Cache bu yaştan eskiyse "bilinmiyor" sayılır (kur tarafındaki
 * `marketRates.isSnapshotStale` karşılığı).
 *
 * Bulgu (Faz F): burada yaş kavramı YOKTU. Edge fonksiyonu / Yahoo günlerce
 * erişilemez olsa bile cache'teki fiyat sonsuza kadar geçerli sayılıyor, üstüne
 * her fetch denemesinde `fetchedAt` tazelenerek yeniden yazılıyordu — yani bayat
 * fiyat kendini sürekli "yeni" ilan ediyor ve `valuationSync` onu
 * `estimated_value_try`'a kalıcı yazıyordu.
 *
 * Yaş ölçüsü `asOf` DEĞİL `fetchedAt`'tir: `asOf` son SEANS kapanışıdır, borsa
 * hafta sonu/tatilde kapalıyken normal olarak 24 saati aşar — onu kullanmak
 * sağlıklı veriyi bayat sayardı. Ölçtüğümüz şey "kaynakla en son ne zaman
 * konuşabildik".
 */
export const STOCK_PRICES_MAX_AGE_HOURS = 24

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function readCachedStockPrices(): StockPricesSnapshot | null {
  if (!isStorageAvailable()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StockPricesSnapshot
    if (!parsed || typeof parsed !== 'object' || !parsed.prices) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedStockPrices(snapshot: StockPricesSnapshot) {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

/** Cache'in kaç saat önce ALINDIĞI; okunamıyorsa null. */
export function stockPricesAgeHours(
  snapshot: StockPricesSnapshot | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!snapshot?.fetchedAt) return null
  const fetchedTime = new Date(snapshot.fetchedAt).getTime()
  if (Number.isNaN(fetchedTime)) return null
  return (now.getTime() - fetchedTime) / (1000 * 60 * 60)
}

/** `maxHours`tan eski (ya da yaşı okunamayan) cache bayattır. */
export function areStockPricesStale(
  snapshot: StockPricesSnapshot | null | undefined,
  maxHours = STOCK_PRICES_MAX_AGE_HOURS,
  now: Date = new Date(),
): boolean {
  const age = stockPricesAgeHours(snapshot, now)
  if (age === null) return true
  return age > maxHours
}

export function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.trim().toUpperCase().replace(/\.IS$/, '')
  return /^[A-Z0-9]{1,10}$/.test(cleaned) ? cleaned : null
}

/**
 * Fetch live prices for the given tickers. Returns the merged price map (fresh
 * values overlaid on the last cache) so a partial/failed fetch still yields
 * usable data. Never throws.
 *
 * ÇOK BAYAT cache taban olarak KULLANILMAZ (bkz. STOCK_PRICES_MAX_AGE_HOURS):
 * eksik fiyat "bilinmiyor" demektir ve çağıranlar (`valueStock`) saklanan/manuel
 * değere düşer. İki şeyi birden önler: bayat fiyatla değerleme ve bayat fiyatın
 * taze `fetchedAt` ile geri yazılıp yaşını sıfırlaması.
 */
export async function fetchStockPrices(
  symbols: string[],
  options: { maxAgeHours?: number; now?: Date } = {},
): Promise<StockPrices> {
  const tickers = Array.from(
    new Set(symbols.map(normalizeTicker).filter((s): s is string => s !== null)),
  )
  const cachedSnapshot = readCachedStockPrices()
  const cached = areStockPricesStale(cachedSnapshot, options.maxAgeHours, options.now)
    ? {}
    : cachedSnapshot?.prices ?? {}
  if (tickers.length === 0) return cached

  try {
    const { data, error } = await supabase.functions.invoke('bist-quote', {
      body: { symbols: tickers },
    })
    if (error || !data || typeof data !== 'object') return cached

    const fresh = (data as { prices?: unknown }).prices
    if (!fresh || typeof fresh !== 'object') return cached

    const merged: StockPrices = { ...cached }
    for (const [symbol, price] of Object.entries(fresh as Record<string, unknown>)) {
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        merged[symbol] = price
      }
    }

    writeCachedStockPrices({
      prices: merged,
      asOf: (data as { asOf?: string }).asOf ?? null,
      fetchedAt: new Date().toISOString(),
    })
    return merged
  } catch {
    return cached
  }
}

// ── Tarihsel kapanış (portföy performansı) ───────────────────────────────────

export type StockHistoryRange = '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max'
export type StockCloseSeries = { t: number[]; c: (number | null)[] }
export type StockHistory = Record<string, StockCloseSeries>

const HISTORY_STORAGE_KEY = 'fp.stockHistory.v1'
const RANGE_ORDER: StockHistoryRange[] = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']

type HistoryCacheEntry = { range: StockHistoryRange; series: StockCloseSeries; fetchedAt: string }
type HistoryCache = Record<string, HistoryCacheEntry>

function readHistoryCache(): HistoryCache {
  if (!isStorageAvailable()) return {}
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as HistoryCache) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeHistoryCache(cache: HistoryCache) {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore quota / privacy-mode failures.
  }
}

function coversRange(cached: StockHistoryRange, wanted: StockHistoryRange): boolean {
  return RANGE_ORDER.indexOf(cached) >= RANGE_ORDER.indexOf(wanted)
}

/**
 * Sembol başına günlük kapanış serisi (`bist-quote` + `range`). Cache: sembol
 * başına en geniş pencere, `fetchedAt` ≤ 24 saat ise ve istenen pencereyi
 * kapsıyorsa yeniden çekilmez. Eksik sembol = "bilinmiyor"; asla fırlatmaz.
 */
export async function fetchStockHistory(
  symbols: string[],
  range: StockHistoryRange,
  options: { maxAgeHours?: number; now?: Date } = {},
): Promise<StockHistory> {
  const tickers = Array.from(new Set(symbols.map(normalizeTicker).filter((s): s is string => s !== null)))
  const now = options.now ?? new Date()
  const maxAge = options.maxAgeHours ?? STOCK_PRICES_MAX_AGE_HOURS
  const cache = readHistoryCache()
  const result: StockHistory = {}
  const missing: string[] = []
  for (const ticker of tickers) {
    const entry = cache[ticker]
    const ageHours = entry ? (now.getTime() - new Date(entry.fetchedAt).getTime()) / 3_600_000 : Number.POSITIVE_INFINITY
    if (entry && ageHours <= maxAge && coversRange(entry.range, range)) result[ticker] = entry.series
    else missing.push(ticker)
  }
  if (missing.length === 0) return result

  try {
    const { data, error } = await supabase.functions.invoke('bist-quote', { body: { symbols: missing, range } })
    if (error || !data || typeof data !== 'object') return result
    const history = (data as { history?: unknown }).history
    if (!history || typeof history !== 'object') return result
    for (const [symbol, series] of Object.entries(history as Record<string, unknown>)) {
      const s = series as StockCloseSeries | null
      if (!s || !Array.isArray(s.t) || !Array.isArray(s.c)) continue
      result[symbol] = s
      cache[symbol] = { range, series: s, fetchedAt: now.toISOString() }
    }
    writeHistoryCache(cache)
    return result
  } catch {
    return result
  }
}
