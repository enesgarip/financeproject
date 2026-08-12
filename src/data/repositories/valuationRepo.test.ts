import { beforeEach, describe, expect, it, vi } from 'vitest'
import { persistEstimatedValues } from './valuationRepo'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: supabaseMocks.from },
}))

/**
 * Satır başına UPDATE yapıldığı için KISMİ başarı gerçek bir durumdur; eskiden
 * yalnız ilk hata dönüyor ve "kaç satır gerçekten yazıldı" bilinmiyordu.
 */
function mockUpdatesByRow(errorsById: Record<string, { message: string } | null>) {
  supabaseMocks.from.mockReset()
  supabaseMocks.from.mockReturnValue({
    update: () => ({
      eq: (_column: string, id: string) => Promise.resolve({ error: errorsById[id] ?? null }),
    }),
  })
}

describe('valuationRepo.persistEstimatedValues', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('boş listede ağa gitmez', async () => {
    supabaseMocks.from.mockReset()

    const result = await persistEstimatedValues('assets', [])

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('ok beklenirdi')
    expect(result.data).toEqual({ requested: 0, updated: 0, failed: [] })
    expect(supabaseMocks.from).not.toHaveBeenCalled()
  })

  it('tam başarıda yazılan satır sayısını bildirir', async () => {
    mockUpdatesByRow({})

    const result = await persistEstimatedValues('assets', [
      { id: 'a', value: 10, rate: 1 },
      { id: 'b', value: 20, rate: 2 },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('ok beklenirdi')
    expect(result.data).toEqual({ requested: 2, updated: 2, failed: [] })
  })

  it('kısmi başarıda ok döner ama düşen satırı kimliğiyle bildirir', async () => {
    mockUpdatesByRow({ b: { message: 'RLS reddi' } })

    const result = await persistEstimatedValues('debts', [
      { id: 'a', value: 10, rate: 1 },
      { id: 'b', value: 20, rate: null },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('ok beklenirdi')
    expect(result.data.updated).toBe(1)
    expect(result.data.failed).toEqual([{ id: 'b', message: 'RLS reddi' }])
  })

  it('hiçbir satır yazılamazsa hata döner', async () => {
    mockUpdatesByRow({ a: { message: 'bağlantı koptu' }, b: { message: 'bağlantı koptu' } })

    const result = await persistEstimatedValues('savings_goals', [
      { id: 'a', value: 10, rate: 1 },
      { id: 'b', value: 20, rate: 2 },
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('hata beklenirdi')
    expect(result.error.message).toBe('bağlantı koptu')
  })
})
