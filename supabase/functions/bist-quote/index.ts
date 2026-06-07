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

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_SYMBOLS = 60
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
      const res = await fetch(`${host}/${symbol}.IS?interval=1d&range=1d`, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

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

  return new Response(
    JSON.stringify({ prices, asOf: new Date().toISOString() }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
})
