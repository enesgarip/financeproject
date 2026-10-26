import { beforeEach, expect, it, vi } from 'vitest'
import { ledgerDrift } from '../../utils/cardLedger'
import { fetchAccountLedgerEvents, fetchAccountLedgerEventsSince, fetchCardLedgerEvents, fetchCardLedgerEventsSince } from './financePanelsRepo'

const mocks = vi.hoisted(() => ({ from: vi.fn(), failureAfterFirst: false, reads: 0, limits: [] as number[] }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }))
const rows = Array.from({ length: 1005 }, (_, i) => ({ id: String(i).padStart(6, '0'), card_id: 'black', occurred_at: '2026-10-26T10:00:00Z', amount_kurus: 100, kind: 'debit' }))

beforeEach(() => {
  mocks.failureAfterFirst = false
  mocks.reads = 0
  mocks.limits = []
  mocks.from.mockImplementation(() => {
    let before: string | null = null
    let cardId = ''
    let since = ''
    const query = {
      select: () => query,
      eq: (_key: string, value: string) => { cardId = value; return query },
      gte: (_key: string, value: string) => { since = value; return query },
      order: () => query,
      lt: (_key: string, value: string) => { before = value; return query },
      limit: async (limit: number) => {
        mocks.limits.push(limit)
        if (mocks.failureAfterFirst && mocks.reads++ > 0) return { data: null, error: { message: 'İkinci sayfa okunamadı.' } }
        return { data: rows.filter(row => row.card_id === cardId && row.occurred_at >= since && (before === null || row.id < before)).toSorted((a, b) => b.id.localeCompare(a.id)).slice(0, limit), error: null }
      },
    }
    return query
  })
})

it('1000 üzeri kart geçmişini tamamlar; aynı zamanlı olaylar kaybolmaz ve sahte fark üretmez', async () => {
  const result = await fetchCardLedgerEvents('black')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  expect(result.data).toHaveLength(1005)
  expect(new Set(result.data.map(row => row.id)).size).toBe(1005)
  expect(result.data[0].id).toBe('001004')
  expect(result.data.at(-1)?.id).toBe('000000')
  expect(ledgerDrift(result.data, 1005)).toBe(0)
  expect(ledgerDrift(result.data.slice(0, 1000), 1005)).toBe(5)
})

it('tam hesap geçmişi ve tarih aralığı karşılaştırmaları da kesilmez', async () => {
  for (const read of [() => fetchAccountLedgerEvents('black'), () => fetchAccountLedgerEventsSince('black', '2026-10-01'), () => fetchCardLedgerEventsSince('black', '2026-10-01')]) {
    const result = await read()
    expect(result.ok && result.data.length).toBe(1005)
  }
  expect(await fetchCardLedgerEventsSince('black', '2026-11-01')).toEqual({ ok: true, data: [] })
  expect(await fetchCardLedgerEvents('other-card')).toEqual({ ok: true, data: [] })
})

it('son üç hareket özeti tek sınırlı okumadır', async () => {
  const result = await fetchAccountLedgerEvents('black', 3)
  expect(result.ok && result.data.length).toBe(3)
  expect(mocks.limits).toEqual([3])
})

it.each([fetchCardLedgerEvents, fetchAccountLedgerEvents])('sonraki sayfa hatası kısmi başarı ve düzeltme girdisi olamaz', async read => {
  mocks.failureAfterFirst = true
  const result = await read('black')
  expect(result.ok).toBe(false)
  expect('data' in result).toBe(false)
})
