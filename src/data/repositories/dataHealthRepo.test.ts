import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDataHealthRows } from './dataHealthRepo'

type PageResponse = {
  data: unknown[] | null
  error: { code?: string; message?: string } | null
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  pageFor: vi.fn<(table: string, beforeId: string | null, limit: number) => PageResponse>(),
  orders: [] as Array<{ table: string; column: string; ascending: boolean | undefined }>,
  pages: [] as Array<{ table: string; beforeId: string | null; limit: number }>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
  },
}))

function testRows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index.toString().padStart(4, '0')}` }))
}

function descendingPage(rows: Array<{ id: string }>, beforeId: string | null, limit: number) {
  return rows
    .filter(({ id }) => beforeId === null || id < beforeId)
    .toSorted((left, right) => right.id.localeCompare(left.id))
    .slice(0, limit)
}

describe('dataHealthRepo.fetchDataHealthRows', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.pageFor.mockReset()
    mocks.orders.length = 0
    mocks.pages.length = 0

    mocks.from.mockImplementation((table: string) => {
      let beforeId: string | null = null
      const builder = {
        select: vi.fn(() => builder),
        order: vi.fn((column: string, options?: { ascending?: boolean }) => {
          mocks.orders.push({ table, column, ascending: options?.ascending })
          return builder
        }),
        lt: vi.fn((_column: string, value: string) => {
          beforeId = value
          return builder
        }),
        limit: vi.fn(async (limit: number) => {
          mocks.pages.push({ table, beforeId, limit })
          return mocks.pageFor(table, beforeId, limit)
        }),
      }
      return builder
    })
  })

  it('loads ledger and non-ledger tables with deterministic PK keysets', async () => {
    const assets = testRows('asset', 1001)
    const cardLedger = testRows('ledger', 1001)
    mocks.pageFor.mockImplementation((table, beforeId, limit) => {
      const rows = table === 'assets' ? assets : table === 'card_ledger' ? cardLedger : []
      return { data: descendingPage(rows, beforeId, limit), error: null }
    })

    const result = await fetchDataHealthRows()

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected successful data-health read')
    expect(result.data.assets).toEqual(assets)
    expect(result.data.cardLedger).toEqual(cardLedger)
    expect(mocks.pages.filter(({ table }) => table === 'assets')).toEqual([
      { table: 'assets', beforeId: null, limit: 500 },
      { table: 'assets', beforeId: 'asset-0501', limit: 500 },
      { table: 'assets', beforeId: 'asset-0001', limit: 500 },
    ])
    expect(mocks.pages.filter(({ table }) => table === 'card_ledger')).toEqual([
      { table: 'card_ledger', beforeId: null, limit: 500 },
      { table: 'card_ledger', beforeId: 'ledger-0501', limit: 500 },
      { table: 'card_ledger', beforeId: 'ledger-0001', limit: 500 },
    ])
    expect(mocks.orders).toHaveLength(mocks.pages.length)
    expect(mocks.orders.every(({ column, ascending }) => column === 'id' && ascending === false)).toBe(true)
  })

  it('preserves the aggregated Result error when a later keyset page fails', async () => {
    const cardLedger = testRows('ledger', 500)
    mocks.pageFor.mockImplementation((table, beforeId, limit) => {
      if (table === 'assets') return { data: null, error: { code: '42501', message: 'Varlıklar okunamadı' } }
      if (table === 'card_ledger' && beforeId === null) {
        return { data: descendingPage(cardLedger, beforeId, limit), error: null }
      }
      if (table === 'card_ledger') return { data: null, error: { code: 'XX000', message: 'Ledger ikinci sayfa okunamadı' } }
      return { data: [], error: null }
    })

    const result = await fetchDataHealthRows()

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected failed data-health read')
    expect(result.error.type).toBe('supabase')
    expect(result.error.code).toBe('42501')
    expect(result.error.message).toBe('Varlıklar okunamadı; Ledger ikinci sayfa okunamadı')
    expect(mocks.pages.filter(({ table }) => table === 'card_ledger')).toEqual([
      { table: 'card_ledger', beforeId: null, limit: 500 },
      { table: 'card_ledger', beforeId: 'ledger-0000', limit: 500 },
    ])
  })
})
