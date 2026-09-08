// Supabase Edge Function: bist-quote
// Proxies live BIST equity prices from Yahoo Finance's public chart endpoint.
// The browser cannot call Yahoo directly (CORS); this function does it server-side
// and returns a clean { prices } map in TRY. No API key required.
//
// Deploy:  supabase functions deploy bist-quote
// Invoke:  supabase.functions.invoke('bist-quote', { body: { symbols: ['THYAO','GARAN'] } })
//          supabase.functions.invoke('bist-quote', { body: { symbols: ['THYAO'], range: '1y' } })
//          → { prices, asOf, history: { THYAO: { t: [unix s], c: [close|null] } } }
//
// `range` (opsiyonel, beyaz liste) verilirse aynı Yahoo çağrısından günlük
// kapanış serisi de döner — portföy performansı "dönem başı değer" için
// (Borsa sayfası). Ek tedarikçi yok; seri Yahoo'nun aynı yanıtından çıkar.
//
// Yahoo is an unofficial source and may change; callers must treat a missing
// price as "unavailable" and fall back to the stored/manual value.

import { fetchWithTimeout, handlePreflight, jsonResponse, rateLimit } from '../_shared/edge.ts'

const MAX_SYMBOLS = 60
const YAHOO_TIMEOUT_MS = 6_000
// query1 sometimes rate-limits datacenter IPs; query2 is a transparent mirror.
const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
]
const HISTORY_RANGES = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'])

type CloseSeries = { t: number[]; c: (number | null)[] }
type Quote = { price: number | null; history: CloseSeries | null }

/** Keep only plausible BIST tickers: 1-10 chars of A-Z/0-9, uppercased, no suffix. */
function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().toUpperCase().replace(/\.IS$/, '')
  return /^[A-Z0-9]{1,10}$/.test(cleaned) ? cleaned : null
}

function extractHistory(result: unknown): CloseSeries | null {
  const r = result as { timestamp?: unknown; indicators?: { quote?: { close?: unknown }[] } } | null
  const timestamps = r?.timestamp
  const closes = r?.indicators?.quote?.[0]?.close
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length) return null
  const t: number[] = []
  const c: (number | null)[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i]
    if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
    const close = closes[i]
    t.push(ts)
    c.push(typeof close === 'number' && Number.isFinite(close) && close > 0 ? Math.round(close * 10000) / 10000 : null)
  }
  return { t, c }
}

async function fetchQuote(symbol: string, range: string | null): Promise<Quote> {
  const query = range ? `interval=1d&range=${range}` : 'interval=1d&range=1d'
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetchWithTimeout(
        `${host}/${symbol}.IS?${query}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } },
        YAHOO_TIMEOUT_MS,
      )
      if (!res.ok) continue
      const json = await res.json()
      const result = json?.chart?.result?.[0]
      const price = result?.meta?.regularMarketPrice
      const validPrice = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
      const history = range ? extractHistory(result) : null
      if (validPrice !== null || history !== null) return { price: validPrice, history }
    } catch {
      // Try the next host.
    }
  }
  return { price: null, history: null }
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  // Yahoo proxy'si ucuz ama yine de tek-IP flood'unu kes.
  const limited = rateLimit(req, { bucket: 'bist-quote', max: 30, windowMs: 60_000 })
  if (limited) return limited

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const rawSymbols = (body as { symbols?: unknown })?.symbols
  const symbols = Array.from(
    new Set(
      (Array.isArray(rawSymbols) ? rawSymbols : [])
        .map(normalizeSymbol)
        .filter((s): s is string => s !== null),
    ),
  ).slice(0, MAX_SYMBOLS)

  const rawRange = (body as { range?: unknown })?.range
  const range = typeof rawRange === 'string' && HISTORY_RANGES.has(rawRange) ? rawRange : null

  const prices: Record<string, number> = {}
  const history: Record<string, CloseSeries> = {}
  await Promise.all(
    symbols.map(async (symbol) => {
      const quote = await fetchQuote(symbol, range)
      if (quote.price !== null) prices[symbol] = quote.price
      if (quote.history !== null) history[symbol] = quote.history
    }),
  )

  return jsonResponse(range ? { prices, history, range, asOf: new Date().toISOString() } : { prices, asOf: new Date().toISOString() })
})
