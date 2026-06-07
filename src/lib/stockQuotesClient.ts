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

export function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.trim().toUpperCase().replace(/\.IS$/, '')
  return /^[A-Z0-9]{1,10}$/.test(cleaned) ? cleaned : null
}

/**
 * Fetch live prices for the given tickers. Returns the merged price map (fresh
 * values overlaid on the last cache) so a partial/failed fetch still yields
 * usable data. Never throws.
 */
export async function fetchStockPrices(symbols: string[]): Promise<StockPrices> {
  const tickers = Array.from(
    new Set(symbols.map(normalizeTicker).filter((s): s is string => s !== null)),
  )
  const cached = readCachedStockPrices()?.prices ?? {}
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
