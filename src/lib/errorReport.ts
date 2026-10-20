/** Kendi Supabase'imizde, gövde/DOM metni toplamadan ayrıntılı hata teşhisi. */
import { supabase } from './supabase'
import type { ClientErrorSource, Json } from '../types/database'
import { sha256Hex } from '../utils/sourceEventId'
import { diagnosticException, diagnosticRoute, diagnosticText, diagnosticUrl, type DiagnosticBreadcrumb, type ErrorDiagnostics } from './errorDiagnostics'

const SESSION_CAP = 50
const QUEUE_CAP = 20
const RETENTION_DAYS = 90
const breadcrumbs: DiagnosticBreadcrumb[] = []
const startedAt = performance.now()
let sessionId = crypto.randomUUID()
let capturedCount = 0
let currentOwner: string | null | undefined
let installed = false
let flushing = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let stop: (() => void) | undefined

type PendingReport = {
  id: string
  owner: string | undefined
  attempts: number
  source: ClientErrorSource
  message: string
  stack: string | null
  route: string
  diagnostics: ErrorDiagnostics
}
const queue: PendingReport[] = []

function trail(kind: string, detail: string) {
  breadcrumbs.push({ at: new Date().toISOString(), kind, detail: diagnosticText(detail, 300) })
  if (breadcrumbs.length > 20) breadcrumbs.shift()
}

function later(delay = 0) {
  if (retryTimer !== undefined) return
  retryTimer = setTimeout(() => { retryTimer = undefined; void flush() }, delay)
}

async function flush() {
  if (flushing || !currentOwner || navigator.onLine === false) return
  flushing = true
  try {
    while (queue.length && currentOwner) {
      const row = queue[0]
      if (row.owner && row.owner !== currentOwner) { queue.shift(); continue }
      row.owner = currentOwner
      const owner: string = currentOwner
      try {
        const fingerprint = await sha256Hex(JSON.stringify([row.source, row.message, row.route,
          row.diagnostics.filename, row.diagnostics.line, row.stack, __APP_COMMIT__]))
        if (currentOwner !== owner || queue[0] !== row) continue
        // Aynı UUID ile retry: sunucuda kaydedilip yanıtı kaybolan rapor çoğalmaz.
        const { error } = await supabase.from('client_errors').upsert({
          id: row.id, user_id: owner, source: row.source, message: row.message, stack: row.stack,
          route: row.route, commit_sha: __APP_COMMIT__, user_agent: diagnosticText(navigator.userAgent, 500),
          fingerprint, diagnostics: row.diagnostics as unknown as Json,
        }, { onConflict: 'id', ignoreDuplicates: true })
        if (currentOwner !== owner || queue[0] !== row) continue
        if (error) throw error
        queue.shift()
      } catch {
        if (queue[0] !== row) continue
        row.attempts += 1
        if (row.attempts >= 3) { queue.shift(); continue }
        later(row.attempts * 5000)
        break
      }
    }
  } catch { /* Raporlama hatası uygulamaya veya yeniden raporlamaya sızmaz. */ }
  finally { flushing = false }
}

type ReportOptions = {
  filename?: string
  line?: number
  column?: number
  componentStack?: string | null
  opaque?: boolean
  request?: ErrorDiagnostics['request']
}
function report(source: ClientErrorSource, value: unknown, options: ReportOptions = {}) {
  try {
    if (currentOwner === null || capturedCount >= SESSION_CAP || queue.length >= QUEUE_CAP) return
    const exception = diagnosticException(value)
    const diagnostics: ErrorDiagnostics = {
      version: 1, captured_at: new Date().toISOString(), session_id: sessionId, kind: source,
      filename: options.filename ? diagnosticUrl(options.filename, location.origin) : null,
      line: options.line || null, column: options.column || null, opaque: options.opaque ?? false,
      online: navigator.onLine, visibility: document.visibilityState, language: navigator.language,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      display_mode: window.matchMedia?.('(display-mode: standalone)').matches ? 'standalone' : 'browser',
      document_state: document.readyState,
      service_worker: navigator.serviceWorker?.controller ? `${diagnosticUrl(navigator.serviceWorker.controller.scriptURL)} (${navigator.serviceWorker.controller.state})` : null,
      page_age_ms: Math.round(performance.now() - startedAt),
      component_stack: options.componentStack ? diagnosticText(options.componentStack, 4000) : null,
      causes: exception.causes, breadcrumbs: breadcrumbs.map(item => ({ ...item })),
      ...(options.request ? { request: options.request } : {}),
    }
    // JSONB sunucu boyut sınırı, çok baytlı Türkçe/hata metninde de korunur.
    while (new TextEncoder().encode(JSON.stringify(diagnostics)).length > 30000) {
      if (diagnostics.breadcrumbs.length) diagnostics.breadcrumbs.shift()
      else if (diagnostics.causes.length) diagnostics.causes.pop()
      else { diagnostics.component_stack = diagnostics.component_stack?.slice(0, 1000) ?? null; break }
    }
    queue.push({ id: crypto.randomUUID(), owner: currentOwner ?? undefined, attempts: 0,
      source, message: exception.message, stack: exception.stack, route: diagnosticRoute(location.pathname), diagnostics })
    capturedCount += 1
    later()
  } catch { /* Tarayıcı API'si/bozuk hata nesnesi raporlamayı engelleyebilir; uygulama sürer. */ }
}

export function reportBoundaryError(error: Error, componentStack?: string | null): void {
  if (!installed) installClientErrorReporting()
  report('boundary', error, { componentStack })
}

/** İdempotent kurulum; dönüş cleanup'ı test/HMR içindir. */
export function installClientErrorReporting(): () => void {
  if (installed) return stop!
  installed = true
  trail('navigation', diagnosticRoute(location.pathname))
  const errorListener = (event: Event) => {
    try {
      if (event instanceof ErrorEvent) {
        const opaque = event.message === 'Script error.' && !event.error && !event.filename
        report('error', event.error ?? event.message, { filename: event.filename, line: event.lineno, column: event.colno, opaque })
      } else if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement || event.target instanceof HTMLImageElement) {
        const target = event.target
        const url = target instanceof HTMLLinkElement ? target.href : target.src
        report('resource', `${target.tagName.toLowerCase()} kaynağı yüklenemedi`, { filename: url })
      }
    } catch { /* Gözlemci hatası uygulamaya taşınmaz. */ }
  }
  const rejectionListener = (event: PromiseRejectionEvent) => report('unhandledrejection', event.reason)
  const securityListener = (event: SecurityPolicyViolationEvent) => {
    report('security', `Güvenlik politikası: ${diagnosticText(event.effectiveDirective)}; engellenen: ${diagnosticUrl(event.blockedURI, location.origin)}`, {
      filename: event.sourceFile, line: event.lineNumber, column: event.columnNumber,
    })
  }
  const clickListener = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const target = event.target.closest('button,a,[role="button"]')
    // textContent/aria-label/id/alan değerleri finans/kişi bilgisi taşıyabilir: okunmaz.
    if (target) trail('interaction', `${target.tagName.toLowerCase()} @ ${diagnosticRoute(location.pathname)}`)
  }
  const navigationListener = () => trail('navigation', diagnosticRoute(location.pathname))
  const onlineListener = () => { trail('connection', 'online'); later() }
  const offlineListener = () => trail('connection', 'offline')
  const visibilityListener = () => { trail('visibility', document.visibilityState); if (document.visibilityState === 'visible') later() }
  window.addEventListener('error', errorListener, true)
  window.addEventListener('unhandledrejection', rejectionListener)
  document.addEventListener('securitypolicyviolation', securityListener)
  document.addEventListener('click', clickListener, true)
  window.addEventListener('popstate', navigationListener)
  window.addEventListener('online', onlineListener)
  window.addEventListener('offline', offlineListener)
  document.addEventListener('visibilitychange', visibilityListener)

  const originalFetch = window.fetch
  const monitoredFetch: typeof fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // Raporlama/retention istekleri kendilerini kaydedemez; auth header/gövde okunmaz.
    let internal = false
    try { internal = new URL(rawUrl, location.origin).pathname === '/rest/v1/client_errors' } catch { /* geçersiz istek özgün fetch'e gider */ }
    if (internal) return originalFetch(input, init)
    const url = diagnosticUrl(rawUrl, location.origin)
    const rawMethod = init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
    const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(rawMethod) ? rawMethod.toUpperCase() : 'OTHER'
    const start = performance.now()
    try {
      const response = await originalFetch(input, init)
      try {
        const duration = Math.round(performance.now() - start)
        const detail = `${method} ${url} → ${response.status} (${duration} ms)`
        trail('request', detail)
        const id = response.headers.get('sb-request-id') ?? response.headers.get('x-vercel-id')
        if (!response.ok) report('network', detail, { request: { url, method, status: response.status,
          duration_ms: duration, request_id: id && /^[\w:-]{1,128}$/.test(id) ? id : null } })
      } catch { /* Gözlemleme response'u değiştirmez. */ }
      return response
    } catch (error) {
      try {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          trail('request', `${method} ${url} → bağlantı kurulamadı`)
          report('network', error, { filename: rawUrl, request: { url, method, status: null,
            duration_ms: Math.round(performance.now() - start), request_id: null } })
        }
      } catch { /* Özgün hata aşağıda aynen fırlatılır. */ }
      throw error
    }
  }
  window.fetch = monitoredFetch
  const historyMethods = ['pushState', 'replaceState'] as const
  const originals = historyMethods.map(method => history[method])
  const wrappers = historyMethods.map((method, index) => {
    const wrapper: History['pushState'] = function (...args) {
      originals[index].apply(history, args)
      try { navigationListener() } catch { /* gezinme korunur */ }
    }
    history[method] = wrapper
    return wrapper
  })
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const nextOwner = session?.user.id ?? null
    if (currentOwner !== undefined && nextOwner !== currentOwner) {
      queue.length = 0
      breadcrumbs.length = 0
      capturedCount = 0
      sessionId = crypto.randomUUID()
    }
    currentOwner = nextOwner
    if (!nextOwner) queue.length = 0
    // GoTrue callback'inin içinde async DB çağrısı yok (auth lock deadlock'u).
    later()
    if (event === 'INITIAL_SESSION' && nextOwner) {
      setTimeout(() => {
        if (currentOwner !== nextOwner) return
        void supabase.from('client_errors').delete().lt('created_at', new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString())
          .then(() => undefined, () => undefined)
      }, 0)
    }
  })
  stop = () => {
    window.removeEventListener('error', errorListener, true)
    window.removeEventListener('unhandledrejection', rejectionListener)
    document.removeEventListener('securitypolicyviolation', securityListener)
    document.removeEventListener('click', clickListener, true)
    window.removeEventListener('popstate', navigationListener)
    window.removeEventListener('online', onlineListener)
    window.removeEventListener('offline', offlineListener)
    document.removeEventListener('visibilitychange', visibilityListener)
    if (window.fetch === monitoredFetch) window.fetch = originalFetch
    historyMethods.forEach((method, index) => { if (history[method] === wrappers[index]) history[method] = originals[index] })
    subscription.unsubscribe()
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryTimer = undefined
    queue.length = 0
    breadcrumbs.length = 0
    capturedCount = 0
    currentOwner = undefined
    installed = false
  }
  return stop
}
