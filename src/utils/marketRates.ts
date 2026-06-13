import { parseNumber } from './formatCurrency'

/**
 * Live FX + gold reference prices (in TRY) used to auto-value foreign-currency
 * and gold holdings, debts, and savings goals.
 *
 * Source: truncgil v4 public feed (https://finans.truncgil.com/v4/today.json).
 * The feed returns one object per symbol shaped like
 * `{ "Buying": 45.95, "Selling": 45.98, "Type": "Currency", "Change": 0.01 }`
 * plus a top-level `"Update_Date": "2026-06-04 00:21:01"`.
 *
 * This module is intentionally pure (no network, no React) so the parsing and
 * conversion rules can be unit tested in isolation.
 */

export type RateSymbol = 'USD' | 'EUR' | 'GBP' | 'GRA' | 'CEYREKALTIN'

/** Which side of the spread to use. Holdings → buying (Alış), obligations → selling (Satış). */
export type RateSide = 'buying' | 'selling'

export type Rate = {
  buying: number
  selling: number
}

export type MarketRatesSnapshot = {
  /** Reference prices in TRY, keyed by symbol. */
  rates: Partial<Record<RateSymbol, Rate>>
  /** Source-reported snapshot time (ISO), if the feed provided one. */
  asOf: string | null
  /** When this client retrieved the snapshot (ISO). */
  fetchedAt: string
}

export const RATE_SYMBOLS: readonly RateSymbol[] = ['USD', 'EUR', 'GBP', 'GRA', 'CEYREKALTIN']

/** Human labels for the symbols, used in tooltips/banners. */
export const RATE_SYMBOL_LABELS: Record<RateSymbol, string> = {
  USD: 'Dolar',
  EUR: 'Euro',
  GBP: 'Sterlin',
  GRA: 'Gram altın',
  CEYREKALTIN: 'Çeyrek altın',
}

function isRateSymbol(value: string): value is RateSymbol {
  return (RATE_SYMBOLS as readonly string[]).includes(value)
}

/**
 * Coerce a feed value into a positive finite number. The v4 feed uses real JSON
 * numbers, but older/edge responses may send Turkish-formatted strings such as
 * "1.234,56" — `parseNumber` already understands both shapes.
 */
function toRateNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const parsed = parseNumber(value)
    return parsed > 0 ? parsed : null
  }
  return null
}

/**
 * The feed reports times in Turkey local time (UTC+3) without a zone suffix,
 * e.g. "2026-06-04 00:21:01". Normalize to an ISO string so the rest of the app
 * can treat it as a real instant. Returns null when the value is unusable.
 */
export function parseUpdateDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) {
    const fallback = new Date(trimmed)
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString()
  }
  const [, year, month, day, hour, minute, second] = match
  // Build the instant explicitly at +03:00 (Turkey has no DST since 2016).
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second ?? '00'}+03:00`
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Parse the raw truncgil JSON object into a normalized snapshot.
 * Unknown/invalid symbols are skipped; returns null only when nothing usable
 * could be extracted.
 */
export function parseTruncgilResponse(
  raw: unknown,
  fetchedAt: string = new Date().toISOString(),
): MarketRatesSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  const rates: Partial<Record<RateSymbol, Rate>> = {}
  for (const symbol of RATE_SYMBOLS) {
    const entry = record[symbol]
    if (!entry || typeof entry !== 'object') continue
    const { Buying, Selling } = entry as Record<string, unknown>
    const buying = toRateNumber(Buying)
    const selling = toRateNumber(Selling)
    if (buying === null || selling === null) continue
    rates[symbol] = { buying, selling }
  }

  if (Object.keys(rates).length === 0) return null

  return {
    rates,
    asOf: parseUpdateDate(record.Update_Date),
    fetchedAt,
  }
}

/** Pull a single `"SYMBOL":{...}` object out of raw feed text and read its prices. */
function extractRateFromText(text: string, symbol: RateSymbol): Rate | null {
  const keyIndex = text.indexOf(`"${symbol}"`)
  if (keyIndex === -1) return null
  const braceStart = text.indexOf('{', keyIndex)
  if (braceStart === -1) return null

  let depth = 0
  for (let i = braceStart; i < text.length; i++) {
    const char = text[i]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          const entry = JSON.parse(text.slice(braceStart, i + 1)) as Record<string, unknown>
          const buying = toRateNumber(entry.Buying)
          const selling = toRateNumber(entry.Selling)
          if (buying === null || selling === null) return null
          return { buying, selling }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * Tolerant text parser. The truncgil endpoint occasionally returns a truncated
 * payload (its long JSON gets cut near the end), which breaks `JSON.parse`. The
 * symbols we need all appear early in the document, so we extract each one
 * individually and ignore any corrupted tail.
 */
export function parseTruncgilText(text: string, fetchedAt: string = new Date().toISOString()): MarketRatesSnapshot | null {
  const rates: Partial<Record<RateSymbol, Rate>> = {}
  for (const symbol of RATE_SYMBOLS) {
    const rate = extractRateFromText(text, symbol)
    if (rate) rates[symbol] = rate
  }
  if (Object.keys(rates).length === 0) return null

  const updateMatch = text.match(/"Update_Date"\s*:\s*"([^"]+)"/)
  return { rates, asOf: parseUpdateDate(updateMatch?.[1] ?? null), fetchedAt }
}

/**
 * Parse raw feed text, preferring a strict full-document parse and falling back
 * to tolerant per-symbol extraction when the payload is truncated/corrupt.
 */
export function parseTruncgilFeed(text: string, fetchedAt: string = new Date().toISOString()): MarketRatesSnapshot | null {
  try {
    const strict = parseTruncgilResponse(JSON.parse(text) as unknown, fetchedAt)
    if (strict) return strict
  } catch {
    // Truncated/invalid JSON — fall back to tolerant extraction below.
  }
  return parseTruncgilText(text, fetchedAt)
}

/**
 * Convert a quantity expressed in `symbol` units into TRY.
 * `'TRY'` passes the amount through unchanged. Returns null when the needed
 * rate is missing so callers can fall back to a manual value.
 */
export function convertToTry(
  amount: number,
  symbol: RateSymbol | 'TRY',
  snapshot: MarketRatesSnapshot | null | undefined,
  side: RateSide,
): number | null {
  if (!Number.isFinite(amount)) return null
  if (symbol === 'TRY') return round2(amount)
  const rate = snapshot?.rates?.[symbol]
  if (!rate) return null
  const price = side === 'buying' ? rate.buying : rate.selling
  if (!Number.isFinite(price) || price <= 0) return null
  return round2(amount * price)
}

export function hasRate(snapshot: MarketRatesSnapshot | null | undefined, symbol: RateSymbol): boolean {
  return Boolean(snapshot?.rates?.[symbol])
}

/** Age of the snapshot in hours, based on its source time (falls back to fetch time). */
export function snapshotAgeHours(
  snapshot: MarketRatesSnapshot | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!snapshot) return null
  const reference = snapshot.asOf ?? snapshot.fetchedAt
  const referenceTime = new Date(reference).getTime()
  if (Number.isNaN(referenceTime)) return null
  return (now.getTime() - referenceTime) / (1000 * 60 * 60)
}

/** A snapshot older than `maxHours` (default 24h) is considered stale. */
export function isSnapshotStale(
  snapshot: MarketRatesSnapshot | null | undefined,
  maxHours = 24,
  now: Date = new Date(),
): boolean {
  const age = snapshotAgeHours(snapshot, now)
  if (age === null) return true
  return age > maxHours
}

// Kur değeri yuvarlaması (para değil) — money.ts'e bağlama; rate precision (Faz C).
function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Symbols serialized for the (Phase 2) server cache upsert payload. */
export function snapshotToUpsertPayload(snapshot: MarketRatesSnapshot) {
  return (Object.entries(snapshot.rates) as [RateSymbol, Rate][])
    .filter((entry): entry is [RateSymbol, Rate] => isRateSymbol(entry[0]) && Boolean(entry[1]))
    .map(([symbol, rate]) => ({
      symbol,
      buying: rate.buying,
      selling: rate.selling,
      fetched_at: snapshot.asOf ?? snapshot.fetchedAt,
    }))
}
