import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  ensureRatesLoaded,
  getRatesState,
  refreshRates,
  subscribeRates,
} from '../lib/marketRatesClient'
import { isSnapshotStale, type MarketRatesSnapshot } from '../utils/marketRates'

export type UseMarketRates = {
  snapshot: MarketRatesSnapshot | null
  asOf: string | null
  loading: boolean
  error: string | null
  source: 'live' | 'cache' | null
  isStale: boolean
  refresh: () => Promise<MarketRatesSnapshot | null>
}

/**
 * Subscribe to the shared market-rate store. The first consumer to mount kicks
 * off a load (live with cache fallback); every consumer re-renders together as
 * the snapshot updates. `refresh()` forces a live re-fetch (the manual button).
 */
export function useMarketRates(): UseMarketRates {
  const state = useSyncExternalStore(subscribeRates, getRatesState, getRatesState)

  useEffect(() => {
    void ensureRatesLoaded()
  }, [])

  const refresh = useCallback(() => refreshRates(true), [])

  return {
    snapshot: state.snapshot,
    asOf: state.snapshot?.asOf ?? state.snapshot?.fetchedAt ?? null,
    loading: state.loading,
    error: state.error,
    source: state.source,
    isStale: isSnapshotStale(state.snapshot),
    refresh,
  }
}
