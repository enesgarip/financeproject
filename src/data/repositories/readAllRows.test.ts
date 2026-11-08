import { describe, expect, it, vi } from 'vitest'
import { readAllRows } from './readAllRows'
const mock = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mock.from } }))
describe('tam PK sayfalama', () => {
  it('1001 satırı eşit tarih olsa da kaybetmez ve imleç ilerler', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: String(2000 - index), due_date: '2026-01-01' }))
    const cursors: string[] = []
    let offset = 0
    mock.from.mockImplementation(() => {
      const query = { select: () => query, order: () => query, limit: () => query, lt: (_key: string, id: string) => { cursors.push(id); return query }, then: (resolve: (value: unknown) => void) => { const data = rows.slice(offset, offset + 500); offset += 500; return Promise.resolve({ data, error: null }).then(resolve) } }
      return query
    })
    expect((await readAllRows('loan_installments')).data).toEqual(rows)
    expect(cursors).toEqual(['1501', '1001'])
  })
  it('sonraki sayfa başarısızsa kısmi toplamı yayınlamaz', async () => {
    let page = 0
    mock.from.mockImplementation(() => {
      const query = { select: () => query, order: () => query, limit: () => query, lt: () => query, then: (resolve: (value: unknown) => void) => Promise.resolve(page++ ? { data: null, error: { message: 'offline' } } : { data: Array.from({ length: 500 }, (_, i) => ({ id: String(2000 - i) })), error: null }).then(resolve) }
      return query
    })
    const result = await readAllRows('assets')
    expect(result.data).toBeNull()
    expect(result.error?.message).toBe('offline')
  })
})
