import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreBackup, type ParsedBackup, type RestoreProgress } from './backup'

const mocks = vi.hoisted(() => ({
  fetchTableRows: vi.fn(),
  insertRows: vi.fn(),
  resetOwnFinanceData: vi.fn(),
}))

vi.mock('../data/repositories/backupRepo', () => ({
  fetchTableRows: mocks.fetchTableRows,
  insertRows: mocks.insertRows,
  resetOwnFinanceData: mocks.resetOwnFinanceData,
}))

describe('restoreBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetOwnFinanceData.mockResolvedValue(undefined)
    mocks.insertRows.mockResolvedValue(true)
  })

  it('uses the transactional reset before restoring every current backup table', async () => {
    const backup: ParsedBackup = {
      schema: 'financeproject-v2',
      exportedAt: null,
      tables: {
        cards: [{ id: 'card-1', user_id: 'old-user' }],
        kasa_buckets: [{ id: 'bucket-1', user_id: 'old-user' }],
        wishlist_items: [{ id: 'wish-1', user_id: 'old-user' }],
        notification_preferences: [{ user_id: 'old-user', weekly_enabled: false }],
      },
      counts: [],
      totalRows: 4,
    }
    const progress: RestoreProgress[] = []

    await restoreBackup(backup, 'new-user', (item) => progress.push(item))

    expect(mocks.resetOwnFinanceData).toHaveBeenCalledOnce()
    expect(mocks.insertRows.mock.calls).toEqual([
      ['cards', [{ id: 'card-1', user_id: 'new-user' }]],
      ['kasa_buckets', [{ id: 'bucket-1', user_id: 'new-user' }]],
      ['wishlist_items', [{ id: 'wish-1', user_id: 'new-user' }]],
      ['notification_preferences', [{ user_id: 'new-user', weekly_enabled: false }]],
    ])
    expect(mocks.resetOwnFinanceData.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.insertRows.mock.invocationCallOrder[0],
    )
    expect(progress[0]?.step).toBe('Mevcut veriler temizleniyor')
    expect(progress.at(-1)?.done).toBe(progress.at(-1)?.total)
  })
})
