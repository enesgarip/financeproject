import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchTableRows, insertRows } from './backupRepo'

type PageResponse = {
  data: unknown[] | null
  error: { code?: string; message?: string } | null
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  pageFor: vi.fn<(table: string, beforeKey: string | null, limit: number) => PageResponse>(),
  orders: [] as Array<{ table: string; column: string; ascending: boolean | undefined }>,
  pages: [] as Array<{ table: string; beforeKey: string | null; limit: number }>,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

function testRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index.toString().padStart(4, '0')}` }))
}

function descendingPage(rows: Array<{ id: string }>, beforeKey: string | null, limit: number) {
  return rows
    .filter(({ id }) => beforeKey === null || id < beforeKey)
    .toSorted((left, right) => right.id.localeCompare(left.id))
    .slice(0, limit)
}

describe('backupRepo.fetchTableRows', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.rpc.mockReset()
    mocks.pageFor.mockReset()
    mocks.orders.length = 0
    mocks.pages.length = 0

    mocks.from.mockImplementation((table: string) => {
      let beforeKey: string | null = null
      const builder = {
        select: vi.fn(() => builder),
        order: vi.fn((column: string, options?: { ascending?: boolean }) => {
          mocks.orders.push({ table, column, ascending: options?.ascending })
          return builder
        }),
        lt: vi.fn((_column: string, value: string) => {
          beforeKey = value
          return builder
        }),
        limit: vi.fn(async (limit: number) => {
          mocks.pages.push({ table, beforeKey, limit })
          return mocks.pageFor(table, beforeKey, limit)
        }),
      }
      return builder
    })
  })

  it('returns every initial row once with deterministic PK keysets', async () => {
    const rows = testRows(1001)
    let pageCount = 0
    mocks.pageFor.mockImplementation((_table, beforeKey, limit) => {
      const page = descendingPage(rows, beforeKey, limit)
      if (pageCount++ === 0) rows.push({ id: 'row-9999' })
      return { data: page, error: null }
    })

    const initialRows = rows.slice(0, 1001)
    await expect(fetchTableRows('card_ledger')).resolves.toEqual(initialRows)
    expect(mocks.pages).toEqual([
      { table: 'card_ledger', beforeKey: null, limit: 500 },
      { table: 'card_ledger', beforeKey: 'row-0501', limit: 500 },
      { table: 'card_ledger', beforeKey: 'row-0001', limit: 500 },
    ])
    expect(mocks.orders).toEqual([
      { table: 'card_ledger', column: 'id', ascending: false },
      { table: 'card_ledger', column: 'id', ascending: false },
      { table: 'card_ledger', column: 'id', ascending: false },
    ])
  })

  it('returns null when the table capability is missing', async () => {
    mocks.pageFor.mockReturnValue({
      data: null,
      error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
    })

    await expect(fetchTableRows('future_table')).resolves.toBeNull()
    expect(mocks.pages).toEqual([{ table: 'future_table', beforeKey: null, limit: 500 }])
  })

  it('uses the user_id primary key for notification preferences', async () => {
    mocks.pageFor.mockReturnValue({ data: [{ user_id: 'user-1' }], error: null })

    await expect(fetchTableRows('notification_preferences')).resolves.toEqual([{ user_id: 'user-1' }])
    expect(mocks.orders).toEqual([
      { table: 'notification_preferences', column: 'user_id', ascending: false },
    ])
  })

  it('throws instead of returning partial rows when a later keyset page fails', async () => {
    const rows = testRows(500).toReversed()
    mocks.pageFor
      .mockReturnValueOnce({ data: rows, error: null })
      .mockReturnValueOnce({ data: null, error: { code: 'XX000', message: 'ikinci sayfa hatası' } })

    await expect(fetchTableRows('cards')).rejects.toThrow('cards okunamadı: ikinci sayfa hatası')
    expect(mocks.pages).toEqual([
      { table: 'cards', beforeKey: null, limit: 500 },
      { table: 'cards', beforeKey: 'row-0000', limit: 500 },
    ])
  })

})

describe('backupRepo.insertRows', () => {
  beforeEach(() => {
    mocks.from.mockReset()
    mocks.rpc.mockReset()
  })

  it('restores data-health acknowledgements through the auth-bound RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: undefined, error: null })

    await expect(insertRows('data_health_issue_acknowledgements', [
      { id: 'ack-1', issue_id: 'issue-1', user_id: 'restored-user' },
      { id: 'ack-2', issue_id: 'issue-2', user_id: 'restored-user' },
    ])).resolves.toBe(true)

    expect(mocks.rpc).toHaveBeenCalledWith('acknowledge_data_health_issues', {
      p_issue_ids: ['issue-1', 'issue-2'],
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('surfaces acknowledgement restore failures', async () => {
    mocks.rpc.mockResolvedValue({ data: undefined, error: { message: 'RPC hatası' } })

    await expect(insertRows('data_health_issue_acknowledgements', [
      { id: 'ack-1', issue_id: 'issue-1' },
    ])).rejects.toThrow('data_health_issue_acknowledgements geri yüklenemedi: RPC hatası')
  })
})
