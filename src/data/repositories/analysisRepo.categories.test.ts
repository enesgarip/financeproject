import { beforeEach, expect, it, vi } from 'vitest'
import { fetchCategorySpendingHistory } from './analysisRepo'

const mocks = vi.hoisted(() => ({ from: vi.fn(), failPage: false, stalled: false, reads: {} as Record<string, number> }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: mocks.from } }))
beforeEach(() => {
  mocks.failPage = false; mocks.stalled = false; mocks.reads = {}
  mocks.from.mockImplementation((table: string) => {
    let before: string | null = null
    const query = {
      select: () => query, order: () => query,
      lt: (_key: string, value: string) => { before = value; return query },
      limit: async (size: number) => {
        mocks.reads[table] = (mocks.reads[table] ?? 0) + 1
        if (mocks.failPage && before && table === 'card_expenses') return { data: null, error: { message: 'Devam sayfası okunamadı' } }
        const rows = Array.from({ length: table === 'card_expenses' ? 1005 : 2 }, (_, i) => ({ id: String(i).padStart(6, '0'), spent_at: '2021-01-01', statement_date: '2021-01-04' }))
        return { data: rows.filter(row => mocks.stalled || !before || row.id < before).reverse().slice(0, size), error: null }
      },
    }
    return query
  })
})
it('snapshot geçmişinden eski ve aynı tarihli 1005 harcamanın tümünü okur', async () => {
  const result = await fetchCategorySpendingHistory()
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  expect(result.data.expenses).toHaveLength(1005)
  expect(new Set(result.data.expenses.map(row => row.id)).size).toBe(1005)
  expect(result.data.installments).toHaveLength(2)
  expect(result.data.statements).toHaveLength(2)
  expect(mocks.reads.card_expenses).toBe(3)
})
it('sonraki sayfa hatası kısmi kategori toplamına dönüşmez', async () => {
  mocks.failPage = true
  expect((await fetchCategorySpendingHistory()).ok).toBe(false)
})
it('ilerlemeyen imleç sonsuz döngü veya mükerrer toplama dönüşmez', async () => {
  mocks.stalled = true
  expect((await fetchCategorySpendingHistory()).ok).toBe(false)
  expect(mocks.reads.card_expenses).toBe(2)
})
