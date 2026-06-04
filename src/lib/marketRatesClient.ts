import {
  type MarketRatesSnapshot,
  parseTruncgilFeed,
  type RateSymbol,
} from '../utils/marketRates'

/**
 * Tiny shared store for live market rates.
 *
 * One fetch is shared across every consumer (rates banner, assets page,
 * dashboard, ...). The latest snapshot is mirrored to localStorage so the app
 * can show last-known values instantly on load and stay usable offline / when
 * the upstream feed is unreachable.
 *
 * Phase 1 is fully client-side: the browser reads the public truncgil feed
 * directly (CORS is open). A future server cache (Phase 2) can replace the
 * direct fetch without changing consumers.
 */

const FEED_URL = 'https://finans.truncgil.com/v4/today.json'
const STORAGE_KEY = 'fp.marketRates.v1'

export type RatesSource = 'live' | 'cache' | null

export type RatesState = {
  snapshot: MarketRatesSnapshot | null
  loading: boolean
  source: RatesSource
  error: string | null
}

let state: RatesState = {
  snapshot: readCachedSnapshot(),
  loading: false,
  source: null,
  error: null,
}

const listeners = new Set<() => void>()
let inflight: Promise<MarketRatesSnapshot | null> | null = null

export function getRatesState(): RatesState {
  return state
}

export function subscribeRates(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setState(patch: Partial<RatesState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readCachedSnapshot(): MarketRatesSnapshot | null {
  if (!isStorageAvailable()) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MarketRatesSnapshot
    if (!parsed || typeof parsed !== 'object' || !parsed.rates) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedSnapshot(snapshot: MarketRatesSnapshot) {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore quota / privacy-mode failures: the in-memory snapshot still works.
  }
}

async function fetchLiveSnapshot(): Promise<MarketRatesSnapshot | null> {
  // The feed sends an aggressive long-lived Cache-Control header, so bust it
  // with a timestamp query and an explicit no-store request.
  const url = `${FEED_URL}?t=${Date.now()}`
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Kur servisi ${response.status} döndü.`)
  }
  // Read as text and parse tolerantly: the feed occasionally truncates its long
  // JSON tail, which would break a strict response.json().
  const text = await response.text()
  return parseTruncgilFeed(text)
}

/**
 * Refresh rates from the live feed. Falls back to the last cached snapshot on
 * failure. Concurrent calls share a single in-flight request unless `force`.
 */
export async function refreshRates(force = false): Promise<MarketRatesSnapshot | null> {
  if (inflight && !force) return inflight

  setState({ loading: true, error: null })

  inflight = (async () => {
    try {
      const snapshot = await fetchLiveSnapshot()
      if (snapshot) {
        writeCachedSnapshot(snapshot)
        setState({ snapshot, source: 'live', loading: false, error: null })
        return snapshot
      }
      throw new Error('Kur verisi okunamadı.')
    } catch (error) {
      const cached = state.snapshot ?? readCachedSnapshot()
      setState({
        snapshot: cached,
        source: cached ? 'cache' : null,
        loading: false,
        error: error instanceof Error ? error.message : 'Kurlar alınamadı.',
      })
      return cached
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/**
 * Ensure rates are loaded once per session. Refreshes from the feed if the
 * current snapshot is missing or older than `maxAgeMinutes`.
 */
export async function ensureRatesLoaded(maxAgeMinutes = 60): Promise<MarketRatesSnapshot | null> {
  const fetchedAt = state.snapshot?.fetchedAt
  if (fetchedAt) {
    const ageMinutes = (Date.now() - new Date(fetchedAt).getTime()) / 60000
    if (Number.isFinite(ageMinutes) && ageMinutes < maxAgeMinutes) {
      return state.snapshot
    }
  }
  return refreshRates()
}

/** Symbols currently priced — handy for diagnostics and tests. */
export function pricedSymbols(): RateSymbol[] {
  const snapshot = state.snapshot
  if (!snapshot) return []
  return (Object.keys(snapshot.rates) as RateSymbol[]).filter((symbol) => snapshot.rates[symbol])
}
