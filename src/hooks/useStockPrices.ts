import { useEffect, useState } from 'react'
import {
  fetchStockPrices,
  normalizeTicker,
  readCachedStockPrices,
  type StockPrices,
} from '../lib/stockQuotesClient'

/**
 * Live BIST prices for the given tickers. Seeds from the localStorage cache for
 * an instant first paint, then refreshes from the `bist-quote` edge function.
 * Refetches whenever the set of symbols changes.
 */
export function useStockPrices(symbols: (string | null | undefined)[]): StockPrices {
  const tickers = Array.from(
    new Set(symbols.map(normalizeTicker).filter((s): s is string => s !== null)),
  ).sort()
  const key = tickers.join(',')

  const [prices, setPrices] = useState<StockPrices>(() => readCachedStockPrices()?.prices ?? {})

  useEffect(() => {
    if (tickers.length === 0) return
    let active = true
    void fetchStockPrices(tickers).then((fresh) => {
      if (active) setPrices(fresh)
    })
    return () => {
      active = false
    }
    // `key` captures the ticker set; tickers array identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return prices
}
