// Shared helpers for Supabase Edge Functions.
// Centralizes CORS headers, JSON responses, and a timeout-guarded fetch so each
// function stays small and external calls can never hang forever.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Returns a ready CORS preflight response for OPTIONS, or null for other methods. */
export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  return null
}

/** İsteğin istemci IP'sini x-forwarded-for / x-real-ip başlığından çıkarır. */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

// Bellek-içi rate-limit kovaları (instance-başı). key = `${bucket}:${ip}` → hit zaman damgaları.
const rateBuckets = new Map<string, number[]>()

/**
 * Bellek-içi kayan-pencere rate-limit (IP + bucket bazlı). Limit aşılırsa 429
 * Response, aksi halde null döner (handlePreflight deseni).
 *
 * SINIR (bilinçli): sayaç edge instance-başınadır — cold start veya farklı
 * instance yeni pencere demektir — ve IP-bazlıdır (IP rotasyonu aşar). Amaç
 * pahalı uçların (Gemini) tek-IP'den hızlı istismarını kesip sağlayıcının kendi
 * kota tavanıyla (ör. Gemini free-tier 429) defense-in-depth kurmak; mutlak kota
 * güvencesi değil. Anon key frontend'de herkese açık olduğundan verify_jwt tek
 * başına bu uçları korumaz → bu hafif kapı ucuz bir ek savunmadır.
 */
export function rateLimit(
  req: Request,
  opts: { max: number; windowMs: number; bucket: string },
): Response | null {
  const key = `${opts.bucket}:${clientIp(req)}`
  const now = Date.now()
  const cutoff = now - opts.windowMs
  const hits = (rateBuckets.get(key) ?? []).filter((t) => t > cutoff)

  if (hits.length >= opts.max) {
    const retrySec = Math.max(1, Math.ceil((hits[0]! + opts.windowMs - now) / 1000))
    return new Response(
      JSON.stringify({ error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' }),
      {
        status: 429,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': String(retrySec) },
      },
    )
  }

  hits.push(now)
  rateBuckets.set(key, hits)

  // Çok sayıda IP'de haritanın sınırsız büyümemesi için fırsatçı süpürme.
  if (rateBuckets.size > 5_000) {
    for (const [k, ts] of rateBuckets) {
      const live = ts.filter((t) => t > cutoff)
      if (live.length === 0) rateBuckets.delete(k)
      else rateBuckets.set(k, live)
    }
  }

  return null
}

/** JSON response with CORS headers applied. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/**
 * fetch with an abort-based timeout (default 10s). Throws (AbortError) on timeout
 * or network failure — callers must catch and translate to a user-facing error.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
