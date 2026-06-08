// Supabase Edge Function: bist-quote
// Proxies live BIST equity prices from Yahoo Finance's public chart endpoint.
// The browser cannot call Yahoo directly (CORS); this function does it server-side
// and returns a clean { prices } map in TRY. No API key required.
//
// Deploy:  supabase functions deploy bist-quote
// Invoke:  supabase.functions.invoke('bist-quote', { body: { symbols: ['THYAO','GARAN'] } })
//
// Yahoo is an unofficial source and may change; callers must treat a missing
// price as "unavailable" and fall back to the stored/manual value.

import { fetchWithTimeout, handlePreflight, jsonResponse } from '../_shared/edge.ts'

const MAX_SYMBOLS = 60
const YAHOO_TIMEOUT_MS = 6_000
// query1 sometimes rate-limits datacenter IPs; query2 is a transparent mirror.
const YAHOO_HOSTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
]

/** Keep only plausible BIST tickers: 1-10 chars of A-Z/0-9, uppercased, no suffix. */
function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().toUpperCase().replace(/\.IS$/, '')
  return /^[A-Z0-9]{1,10}$/.test(cleaned) ? cleaned : null
}

async function fetchPrice(symbol: string): Promise<number | null> {
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetchWithTimeout(
        `${host}/${symbol}.IS?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } },
        YAHOO_TIMEOUT_MS,
      )
      if (!res.ok) continue
      const json = await res.json()
      const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price
    } catch {
      // Try the next host.
    }
  }
  return null
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

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

  const prices: Record<string, number> = {}
  await Promise.all(
    symbols.map(async (symbol) => {
      const price = await fetchPrice(symbol)
      if (price !== null) prices[symbol] = price
    }),
  )

  return jsonResponse({ prices, asOf: new Date().toISOString() })
})
