/** Yalnız teknik bağlam: URL sorguları, DOM metni, form ve ağ gövdeleri yoktur. */
export type DiagnosticBreadcrumb = { at: string; kind: string; detail: string }
export type ErrorDiagnostics = {
  version: 1
  captured_at: string
  session_id: string
  kind: string
  filename: string | null
  line: number | null
  column: number | null
  opaque: boolean
  online: boolean
  visibility: string
  language: string
  viewport: string
  display_mode: string
  document_state: string
  service_worker: string | null
  page_age_ms: number
  component_stack: string | null
  causes: string[]
  breadcrumbs: DiagnosticBreadcrumb[]
  request?: { url: string; method: string; status: number | null; duration_ms: number; request_id: string | null }
}

const ROUTES = new Set(['login', 'kartlar', 'varliklar', 'borclar', 'krediler', 'kisiler', 'odemeler',
  'hedefler', 'analiz', 'detay', 'asistan', 'veri-sagligi', 'islemler', 'borsa', 'araclar', 'maas',
  'alsam-mi', 'plan', 'butce', 'liste', 'takvim', 'ayarlar', 'kasa'])

export function diagnosticRoute(path: string): string {
  return '/' + path.split(/[?#]/)[0].split('/').filter(Boolean)
    .map(part => ROUTES.has(part) ? part : ':param').join('/')
}

export function diagnosticUrl(value: string, base = 'https://diagnostic.invalid'): string {
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol)) return `[${url.protocol.replace(':', '')}]`
    let path = diagnosticRoute(url.pathname)
    if (/^\/assets\/[\w.-]+\.(js|mjs|css)(:\d+){0,2}$/.test(url.pathname)) path = url.pathname
    else if (/^\/(rest|auth|functions)\/v1\//.test(url.pathname)) {
      const parts = url.pathname.split('/').filter(Boolean)
      path = '/' + parts.slice(0, parts[2] === 'rpc' ? 4 : 3)
        .map(part => /^[a-z_][a-z_0-9-]*$/.test(part) ? part : ':param').join('/')
    } else if (url.pathname === '/sw.js' || url.pathname === '/_vercel/insights/script.js') path = url.pathname
    return (url.origin === 'https://diagnostic.invalid' ? '' : url.origin) + path
  } catch { return '[geçersiz adres]' }
}

export function diagnosticText(value: string, limit = 2000): string {
  return value.slice(0, 32000)
    .replace(/https?:\/\/[^\s"'<>()[\]]+/gi, url => diagnosticUrl(url))
    .replace(/\/[\w./-]+\?[^\s"'<>]+/g, url => diagnosticUrl(url))
    .replace(/\bBearer\s+\S+/gi, 'Bearer [gizli]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[token]')
    .replace(/\bsb_(?:secret|publishable)_[\w-]+\b/g, '[anahtar]')
    .replace(/\b(access_token|refresh_token|apikey|api_key|password|authorization)["']?\s*[=:]\s*["']?[^\s,;"'}]+/gi, '$1=[gizli]')
    .replace(/\b(Key\s*\([^)]*\)\s*=\s*)\([^)]*\)/gi, '$1([gizli])')
    .replace(/\bFailing row contains\s*\([^)]*\)/gi, 'Failing row contains ([gizli])')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[e-posta]')
    .replace(/\bTR\s*\d[\d\s]{24,32}/gi, '[IBAN]')
    .replace(/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi, '[kimlik]')
    .replace(/\b\d[\d.,]*\s*(?:\b(?:TL|TRY|EUR|USD)\b|₺)/gi, '[tutar]')
    .replace(/₺\s*\d[\d.,]*/g, '[tutar]')
    .replace(/(?<![:\d])\b\d{6,}\b/g, '[numara]')
    .slice(0, limit)
}

/** Sadece Error ve bilinen teknik alanlar; döngüsel payload/response/form serileştirilmez. */
export function diagnosticException(value: unknown): { message: string; stack: string | null; causes: string[] } {
  const seen = new Set<unknown>()
  const causes: string[] = []
  let message = 'Bilinmeyen hata'
  let stack: string | null = null
  function visit(item: unknown, depth: number) {
    if (depth > 3 || seen.has(item)) return
    seen.add(item)
    try {
      let text: string
      if (typeof item === 'string') text = item
      else if (item && typeof item === 'object') {
        const error = item as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; cause?: unknown; errors?: unknown }
        text = [typeof error.name === 'string' ? error.name : '', typeof error.message === 'string' ? error.message : '',
          typeof error.code === 'string' ? error.code : ''].filter(Boolean).join(': ') || 'Nesne olarak bildirilen hata'
        if (depth === 0 && typeof error.stack === 'string') stack = diagnosticText(error.stack, 8000)
        if (depth === 0) message = diagnosticText(text)
        else causes.push(diagnosticText(text))
        if (error.cause != null) visit(error.cause, depth + 1)
        if (Array.isArray(error.errors)) error.errors.slice(0, 3).forEach(child => visit(child, depth + 1))
        return
      } else text = item == null ? 'Bilinmeyen hata' : String(item)
      if (depth === 0) message = diagnosticText(text)
      else causes.push(diagnosticText(text))
    } catch { /* Hatalı getter/toString raporlamayı bozamaz. */ }
  }
  visit(value, 0)
  return { message, stack, causes: causes.slice(0, 6) }
}
