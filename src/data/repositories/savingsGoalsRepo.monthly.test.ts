import { beforeEach, expect, it, vi } from 'vitest'
import { fetchGoalMonthlyData } from './savingsGoalsRepo'

const mocks = vi.hoisted(() => ({ from: vi.fn(), failSecondPage: false, missing: false }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }))

beforeEach(() => {
  mocks.failSecondPage = false
  mocks.missing = false
  mocks.from.mockImplementation((table: string) => {
    let before: string | null = null
    let pageSize = 0
    const query = {
      select: () => query,
      order: () => query,
      limit: (size: number) => { pageSize = size; return query },
      lt: (_column: string, cursor: string) => { before = cursor; return query },
      then: (resolve: (value: unknown) => unknown) => {
        if (mocks.missing && table === 'savings_goal_monthly_plans') return Promise.resolve(resolve({ data: null, error: { code: 'PGRST205', message: 'Could not find the table in schema cache' } }))
        if (mocks.failSecondPage && before && table === 'gold_lots') return Promise.resolve(resolve({ data: null, error: { message: 'Bağlantı kesildi.' } }))
        const rows = table === 'gold_lots' ? Array.from({ length: 1005 }, (_, i) => ({ id: String(i).padStart(5, '0') })) : []
        return Promise.resolve(resolve({ data: rows.filter(row => before === null || row.id < before).toSorted((a, b) => b.id.localeCompare(a.id)).slice(0, pageSize), error: null }))
      },
    }
    return query
  })
})

it('1000 üzeri altın geçmişini PK imleciyle eksiksiz okur', async () => {
  const result = await fetchGoalMonthlyData()
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  expect(result.data.lots).toHaveLength(1005)
  expect(new Set(result.data.lots.map(row => row.id)).size).toBe(1005)
})

it('sonraki sayfa hatasında kısmi toplamı başarılı saymaz', async () => {
  mocks.failSecondPage = true
  const result = await fetchGoalMonthlyData()
  expect(result.ok).toBe(false)
})

it('migration eksikse özelliğin henüz açılmadığını açıklar', async () => {
  mocks.missing = true
  const result = await fetchGoalMonthlyData()
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error.type).toBe('missing-capability')
    expect(result.error.message).toContain('migration/RPC')
    expect(result.error.message).toContain('PGRST205')
  }
})
