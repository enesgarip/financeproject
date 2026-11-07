import { beforeEach, expect, it, vi } from 'vitest'
import { fetchForeignCardSms } from './foreignCardSmsRepo'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), ambiguous: false, failHistory: false, failPending: false }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
const raw = '07.11.2026 19:37:28 tarihinde 9032 ile biten kartinizla, STEAM firmasindan, 59,99 USD islem yapilmistir.'
beforeEach(() => {
  mocks.ambiguous = false; mocks.failHistory = false; mocks.failPending = false
  mocks.rpc.mockReset().mockResolvedValue({ data: 'pending', error: null })
  mocks.from.mockReset().mockImplementation((table: string) => {
    let before: string | null = null
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
      lt: (_key: string, value: string) => { before = value; return query },
      then: (resolve: (value: unknown) => unknown) => {
        if ((table === 'sms_log' && mocks.failHistory) || (table === 'foreign_card_sms' && mocks.failPending)) return resolve({ data: null, error: { message: 'Bağlantı hatası.' } })
        const rows = table === 'sms_log' ? Array.from({ length: 1005 }, (_, index) => ({ id: String(index).padStart(5, '0'), raw_sms: index % 2 ? raw : raw.replaceAll(' ', '\n') }))
          : table === 'card_aliases' ? [{ id: 'alias', card_id: 'card', last_four_digits: '9032' }, ...(mocks.ambiguous ? [{ id: 'alias-other', card_id: 'other', last_four_digits: '9032' }] : [])]
          : [{ id: 'pending', card_id: 'card', native_amount: 59.99, currency: 'USD', spent_at: '2026-11-07T19:37:28+03:00' }]
        return resolve({ data: rows.filter(row => !before || row.id < before).toSorted((a, b) => b.id.localeCompare(a.id)).slice(0, 500), error: null })
      },
    }
    return query
  })
})

it('1000 üzeri eski hata kaydını sayfalar, aynı döviz SMS’ini yalnız bir kez kurtarır', async () => {
  const result = await fetchForeignCardSms('user')
  expect(result.ok).toBe(true)
  expect(mocks.from.mock.calls.filter(([table]) => table === 'sms_log')).toHaveLength(3)
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_user_id: 'user', p_card_id: 'card', p_native_amount: 59.99, p_currency: 'USD' })
  if (result.ok) expect(result.data).toMatchObject({ rows: [{ native_amount: 59.99, currency: 'USD' }], recoveryWarning: null })
})

it('belirsiz kart eşleşmesinde yazmaz, mevcut bekleyenleri uyarıyla gösterir', async () => {
  mocks.ambiguous = true
  const result = await fetchForeignCardSms('user')
  expect(mocks.rpc).not.toHaveBeenCalled()
  expect(result.ok && result.data.rows).toHaveLength(1)
  expect(result.ok && result.data.recoveryWarning).toContain('kartı eşleşmedi')
})

it('eski günlük okunamıyorsa uyarır; bekleyen liste okunamıyorsa boş başarı üretmez', async () => {
  mocks.failHistory = true
  const result = await fetchForeignCardSms('user')
  expect(result.ok && result.data.recoveryWarning).toContain('taranamadı')
  mocks.failPending = true
  expect((await fetchForeignCardSms('user')).ok).toBe(false)
})
