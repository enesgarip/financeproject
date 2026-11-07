// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const cached = {
  rates: { USD: { buying: 40, selling: 41 } },
  asOf: '2026-11-07T06:00:00.000Z',
  fetchedAt: '2026-11-07T06:00:00.000Z',
}
const feed = { Update_Date: '2026-11-07 12:00:00', USD: { Buying: 42, Selling: 43 } }
let request = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-07T09:00:00.000Z'))
  localStorage.clear()
  request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', request)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

it('sayfa geçişlerindeki otomatik çağrılar bir dakika bekler; eski kopyanın yaşı ve hata durumu korunur', async () => {
  localStorage.setItem('fp.marketRates.v1', JSON.stringify(cached))
  const client = await import('./marketRatesClient')
  await client.ensureRatesLoaded()
  const fallbackState = client.getRatesState()
  expect(fallbackState).toMatchObject({ snapshot: cached, source: 'cache', loading: false, error: 'Failed to fetch' })
  for (let i = 0; i < 5; i++) expect(await client.ensureRatesLoaded()).toEqual(cached)
  expect(request).toHaveBeenCalledTimes(1)
  expect(client.getRatesState()).toBe(fallbackState)
  await vi.advanceTimersByTimeAsync(59_999)
  await client.ensureRatesLoaded()
  expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await client.ensureRatesLoaded()
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(localStorage.getItem('fp.marketRates.v1')!)).toEqual(cached)
})

it('önbellek yokken de bekler, veri veya sıfır kur uydurmaz', async () => {
  const client = await import('./marketRatesClient')
  expect(await client.ensureRatesLoaded()).toBeNull()
  expect(await client.ensureRatesLoaded()).toBeNull()
  expect(request).toHaveBeenCalledTimes(1)
  expect(client.getRatesState()).toMatchObject({ snapshot: null, source: null, error: 'Failed to fetch', loading: false })
})

it('elle Yenile beklemeyi aşar; başarı beklemeyi ve hatayı kaldırır', async () => {
  const client = await import('./marketRatesClient')
  await client.ensureRatesLoaded()
  request.mockResolvedValueOnce(Response.json(feed)).mockResolvedValueOnce(Response.json(feed))
  const live = await client.refreshRates(true)
  expect(request).toHaveBeenCalledTimes(2)
  expect(live?.rates.USD?.buying).toBe(42)
  expect(client.getRatesState()).toMatchObject({ source: 'live', error: null, loading: false })
  // 0 dakikalık pencereyle otomatik deneme: eski başarısızlığın beklemesi kalkmıştır.
  await client.ensureRatesLoaded(0)
  expect(request).toHaveBeenCalledTimes(3)
})

it('elle deneme de başarısızsa bir dakikayı son başarısızlıktan başlatır', async () => {
  const client = await import('./marketRatesClient')
  await client.ensureRatesLoaded()
  await vi.advanceTimersByTimeAsync(30_000)
  await client.refreshRates(true)
  await vi.advanceTimersByTimeAsync(59_999)
  await client.ensureRatesLoaded()
  expect(request).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  await client.ensureRatesLoaded()
  expect(request).toHaveBeenCalledTimes(3)
})

it('bekleme sırasında elle başlatılan isteği diğer tüketiciler paylaşır', async () => {
  const client = await import('./marketRatesClient')
  await client.ensureRatesLoaded()
  let finish!: (response: Response) => void
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const manual = client.refreshRates(true)
  const automatic = client.ensureRatesLoaded()
  expect(request).toHaveBeenCalledTimes(2)
  finish(Response.json(feed))
  expect(await automatic).toEqual(await manual)
  expect(client.getRatesState().source).toBe('live')
})

it.each([503, 200])('HTTP hatası veya okunamayan gövde de tekrar beklemesini başlatır (%i)', async status => {
  request.mockResolvedValue(new Response('geçersiz kur verisi', { status }))
  const client = await import('./marketRatesClient')
  await client.ensureRatesLoaded()
  await client.ensureRatesLoaded()
  expect(request).toHaveBeenCalledTimes(1)
  expect(client.getRatesState()).toMatchObject({ snapshot: null, loading: false })
  expect(client.getRatesState().error).toBeTruthy()
})
