import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runFinanceMaintenance } from './financeSnapshotRepo'

const mocks = vi.hoisted(() => ({
  ensureRatesLoaded: vi.fn(),
  rpc: vi.fn(),
  syncAutoValuedRows: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}))

vi.mock('../../lib/marketRatesClient', () => ({
  ensureRatesLoaded: mocks.ensureRatesLoaded,
}))

vi.mock('../../utils/valuationSync', () => ({
  syncAutoValuedRows: mocks.syncAutoValuedRows,
}))

describe('financeSnapshotRepo.runFinanceMaintenance', () => {
  beforeEach(() => {
    mocks.ensureRatesLoaded.mockReset()
    mocks.rpc.mockReset()
    mocks.syncAutoValuedRows.mockReset()
    mocks.ensureRatesLoaded.mockResolvedValue({ rates: 'snapshot' })
    mocks.syncAutoValuedRows.mockResolvedValue({ updated: 1, assets: 1, debts: 0, goals: 0, failed: 0 })
  })

  it('runs maintenance RPCs and best-effort valuation sync', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: 3, error: null })

    // Dönüş = değişen satır toplamı (2 taksit + 3 kesim + 1 değerleme);
    // çağıran 0'da snapshot invalidation'ını atlar.
    await expect(runFinanceMaintenance()).resolves.toBe(6)

    // BM-5: kart talimatlı ödemeler proaktif yazılmaz (post_due_card_auto_payments kaldırıldı).
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'post_due_card_installments')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'cut_due_card_statements')
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.ensureRatesLoaded).toHaveBeenCalledTimes(1)
    expect(mocks.syncAutoValuedRows).toHaveBeenCalledWith({ rates: 'snapshot' })
  })

  it('surfaces missing maintenance RPC deployment instead of silently degrading', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.post_due_card_installments in the schema cache' },
      })
      .mockResolvedValueOnce({ data: 0, error: null })

    await expect(runFinanceMaintenance()).rejects.toThrow(
      'Finans bakım altyapısı canlı veritabanında henüz görünmüyor. Beklenen migration/RPC deploy edilince bu işlem açılacak. Supabase kodu: PGRST202.',
    )
    expect(mocks.syncAutoValuedRows).toHaveBeenCalledWith({ rates: 'snapshot' })
  })

  it('returns 0 when maintenance touches nothing so callers can skip the snapshot refetch', async () => {
    mocks.syncAutoValuedRows.mockResolvedValue({ updated: 0, assets: 0, debts: 0, goals: 0, failed: 0 })
    mocks.rpc
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValueOnce({ data: 0, error: null })

    await expect(runFinanceMaintenance()).resolves.toBe(0)
  })
})
