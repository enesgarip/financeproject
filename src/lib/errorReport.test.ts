// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../utils/sourceEventId', () => ({ sha256Hex: async (value: string) => `hash:${value}` }))
const mock = vi.hoisted(() => ({ upsert: vi.fn(), lt: vi.fn(), onAuth: vi.fn(), unsubscribe: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: {
  from: () => ({ upsert: mock.upsert, delete: () => ({ lt: mock.lt }) }),
  auth: { onAuthStateChange: mock.onAuth },
} }))
import { installClientErrorReporting, reportBoundaryError } from './errorReport'
let cleanup: () => void
let auth: (event: string, session: { user: { id: string } } | null) => void
let originalFetch: typeof fetch
let rawFetch = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.useFakeTimers()
  originalFetch = window.fetch
  rawFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }))
  window.fetch = rawFetch
  mock.upsert.mockReset().mockResolvedValue({ error: null })
  mock.lt.mockResolvedValue({ error: null })
  mock.onAuth.mockImplementation(callback => { auth = callback; return { data: { subscription: { unsubscribe: mock.unsubscribe } } } })
  cleanup = installClientErrorReporting()
  auth('INITIAL_SESSION', { user: { id: 'owner-a' } })
})
afterEach(() => { cleanup(); window.fetch = originalFetch; vi.useRealTimers(); vi.restoreAllMocks() })
async function flush() { await vi.advanceTimersByTimeAsync(1) }

it('dosya/satır, sürüm, neden zinciri ve bileşen izini kaydeder', async () => {
  window.dispatchEvent(new ErrorEvent('error', { message: 'Hata', error: new Error('Hata'), filename: 'https://app.test/assets/main.js?token=secret', lineno: 12, colno: 5 }))
  reportBoundaryError(new Error('React çöktü', { cause: new Error('neden') }), 'at Dashboard')
  await flush()
  const rows = mock.upsert.mock.calls.map(call => call[0])
  expect(rows[0]).toMatchObject({ source: 'error', user_id: 'owner-a', diagnostics: { line: 12, column: 5, filename: 'https://app.test/assets/main.js', version: 1 } })
  expect(rows[1].diagnostics).toMatchObject({ component_stack: 'at Dashboard', causes: ['Error: neden'] })
  expect(JSON.stringify(rows)).not.toContain('secret')
})
it('opak hatayı işaretler ve eş mesajın farklı konumlarını kaybetmez', async () => {
  window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
  window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', filename: 'https://app.test/assets/other.js', lineno: 8 }))
  await flush()
  expect(mock.upsert).toHaveBeenCalledTimes(2)
  expect(mock.upsert.mock.calls[0][0].diagnostics.opaque).toBe(true)
  expect(mock.upsert.mock.calls[0][0].fingerprint).not.toBe(mock.upsert.mock.calls[1][0].fingerprint)
})
it('sunucuya ulaşmış kaydın retryını aynı UUID ile yapar', async () => {
  mock.upsert.mockResolvedValueOnce({ error: { message: 'offline' } })
  window.dispatchEvent(new ErrorEvent('error', { message: 'Aynı hata' }))
  await flush()
  await vi.advanceTimersByTimeAsync(5000)
  expect(mock.upsert).toHaveBeenCalledTimes(2)
  expect(mock.upsert.mock.calls[0][0].id).toBe(mock.upsert.mock.calls[1][0].id)
  expect(mock.upsert.mock.calls[1][1]).toEqual({ onConflict: 'id', ignoreDuplicates: true })
})
it('ağ yanıtını ve hatasını değiştirmez; gövde ve query toplamaz', async () => {
  const response = new Response('{"private":"secret"}', { status: 503 })
  rawFetch.mockResolvedValueOnce(response)
  const input = 'https://app.test/rest/v1/cards?owner=secret'
  expect(await window.fetch(input)).toBe(response)
  expect(await response.text()).toContain('secret')
  await flush()
  expect(mock.upsert.mock.calls[0][0].source).toBe('network')
  expect(JSON.stringify(mock.upsert.mock.calls)).not.toContain('secret')
  const error = new TypeError('Failed to fetch')
  rawFetch.mockRejectedValueOnce(error)
  await expect(window.fetch(input)).rejects.toBe(error)
  await flush()
  expect(mock.upsert).toHaveBeenCalledTimes(2)
})
it('raporlamanın kendi isteğini ve iptal edilen isteği tekrar raporlamaz', async () => {
  rawFetch.mockResolvedValueOnce(new Response('{}', { status: 500 }))
  await window.fetch('https://app.test/rest/v1/client_errors?select=*')
  rawFetch.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
  await expect(window.fetch('/rest/v1/cards')).rejects.toThrow('cancelled')
  await flush()
  expect(mock.upsert).not.toHaveBeenCalled()
})
it('çökme döngüsünde oturum başına 50 kayıt sınırını korur', async () => {
  for (let i = 0; i < 60; i++) {
    window.dispatchEvent(new ErrorEvent('error', { message: `Hata ${i}` }))
    await flush()
  }
  expect(mock.upsert).toHaveBeenCalledTimes(50)
})
it('oturum değişince önceki kullanıcının bekleyen kaydını göndermez', async () => {
  window.dispatchEvent(new ErrorEvent('error', { message: 'Eski kullanıcının hatası' }))
  auth('SIGNED_OUT', null)
  auth('SIGNED_IN', { user: { id: 'owner-b' } })
  window.dispatchEvent(new ErrorEvent('error', { message: 'Yeni hata' }))
  await flush()
  expect(mock.upsert).toHaveBeenCalledTimes(1)
  expect(mock.upsert.mock.calls[0][0].user_id).toBe('owner-b')
})
it('etkileşim bağlamına buton metni veya form değeri koymaz', async () => {
  document.body.innerHTML = '<button>Ali 1000 TL password=secret</button><input value="secret" />'
  document.querySelector('button')!.click()
  window.dispatchEvent(new ErrorEvent('error', { message: 'Test' }))
  await flush()
  expect(JSON.stringify(mock.upsert.mock.calls[0][0].diagnostics.breadcrumbs)).not.toMatch(/Ali|1000|secret/)
  expect(mock.upsert.mock.calls[0][0].diagnostics.breadcrumbs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'interaction' })]))
})
it('kurulum iki kez çağrılsa da dinleyicileri çoğaltmaz', async () => {
  expect(installClientErrorReporting()).toBe(cleanup)
  window.dispatchEvent(new ErrorEvent('error', { message: 'Tek hata' }))
  await flush()
  expect(mock.upsert).toHaveBeenCalledTimes(1)
})
it('çevrimdışıyken bellekte tutar ve bağlantı dönünce gönderir', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new ErrorEvent('error', { message: 'Çevrimdışı hata' }))
  await flush()
  expect(mock.upsert).not.toHaveBeenCalled()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await flush()
  expect(mock.upsert).toHaveBeenCalledTimes(1)
  expect(mock.upsert.mock.calls[0][0].diagnostics.online).toBe(false)
})
it('kaynak yükleme hatasını capture aşamasında yakalar', async () => {
  const script = document.createElement('script')
  script.type = 'application/json'
  script.src = 'https://app.test/assets/missing.js?secret=value'
  document.body.append(script)
  script.dispatchEvent(new Event('error'))
  await flush()
  expect(mock.upsert.mock.calls[0][0]).toMatchObject({ source: 'resource', diagnostics: { filename: 'https://app.test/assets/missing.js' } })
  script.remove()
})
it('Promise nesnesinin teknik mesajını ve kodunu alır, payloadı almaz', async () => {
  const event = new Event('unhandledrejection')
  Object.defineProperty(event, 'reason', { value: { message: 'RPC başarısız', code: 'P0001', body: 'secret' } })
  window.dispatchEvent(event)
  await flush()
  expect(mock.upsert.mock.calls[0][0]).toMatchObject({ source: 'unhandledrejection', message: 'RPC başarısız: P0001' })
  expect(JSON.stringify(mock.upsert.mock.calls)).not.toContain('secret')
})
