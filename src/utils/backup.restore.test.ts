import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreBackup, type ParsedBackup, type RestoreProgress } from './backup'

const mocks = vi.hoisted(() => ({
  fetchTableRows: vi.fn(),
  insertRows: vi.fn(),
  resetOwnFinanceData: vi.fn(),
  restoreViaTransactionalRpc: vi.fn(),
}))

vi.mock('../data/repositories/backupRepo', () => ({
  fetchTableRows: mocks.fetchTableRows,
  insertRows: mocks.insertRows,
  resetOwnFinanceData: mocks.resetOwnFinanceData,
  restoreViaTransactionalRpc: mocks.restoreViaTransactionalRpc,
}))

function backupFixture(): ParsedBackup {
  return {
    schema: 'financeproject-v2',
    exportedAt: null,
    tables: {
      cards: [{ id: 'card-1', user_id: 'old-user' }],
      kasa_buckets: [{ id: 'bucket-1', user_id: 'old-user' }],
      wishlist_items: [{ id: 'wish-1', user_id: 'old-user' }],
      data_health_issue_acknowledgements: [{ id: 'ack-1', user_id: 'old-user', issue_id: 'issue-1' }],
      notification_preferences: [{ user_id: 'old-user', weekly_enabled: false }],
    },
    counts: [],
    totalRows: 5,
  }
}

describe('restoreBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resetOwnFinanceData.mockResolvedValue(undefined)
    mocks.insertRows.mockResolvedValue(true)
  })

  it('birincil yol: transactional RPC başarılıysa REST replay HİÇ koşmaz', async () => {
    mocks.restoreViaTransactionalRpc.mockResolvedValue({ cards: 1 })
    const progress: RestoreProgress[] = []

    await restoreBackup(backupFixture(), 'new-user', (item) => progress.push(item))

    expect(mocks.restoreViaTransactionalRpc).toHaveBeenCalledExactlyOnceWith(backupFixture().tables)
    expect(mocks.resetOwnFinanceData).not.toHaveBeenCalled()
    expect(mocks.insertRows).not.toHaveBeenCalled()
    expect(progress.at(-1)?.step).toBe('Tamamlandı')
  })

  it('RPC deploy değilse (null) eski REST yolu aynen: reset + parent-first insert + user_id rewrite', async () => {
    mocks.restoreViaTransactionalRpc.mockResolvedValue(null)
    const progress: RestoreProgress[] = []

    await restoreBackup(backupFixture(), 'new-user', (item) => progress.push(item))

    expect(mocks.resetOwnFinanceData).toHaveBeenCalledOnce()
    expect(mocks.insertRows.mock.calls).toEqual([
      ['cards', [{ id: 'card-1', user_id: 'new-user' }]],
      ['kasa_buckets', [{ id: 'bucket-1', user_id: 'new-user' }]],
      ['wishlist_items', [{ id: 'wish-1', user_id: 'new-user' }]],
      ['data_health_issue_acknowledgements', [{ id: 'ack-1', user_id: 'new-user', issue_id: 'issue-1' }]],
      ['notification_preferences', [{ user_id: 'new-user', weekly_enabled: false }]],
    ])
    expect(mocks.resetOwnFinanceData.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.insertRows.mock.invocationCallOrder[0],
    )
    expect(progress.at(-1)?.done).toBe(progress.at(-1)?.total)
  })

  it('RPC hatası (deploy-eksikliği dışı) aynen fırlar — REST yolu denenmez, veri değişmemiştir', async () => {
    mocks.restoreViaTransactionalRpc.mockRejectedValue(new Error('Geri yükleme başarısız — hiçbir veri değişmedi: X'))

    await expect(restoreBackup(backupFixture(), 'new-user')).rejects.toThrow('hiçbir veri değişmedi')
    expect(mocks.resetOwnFinanceData).not.toHaveBeenCalled()
    expect(mocks.insertRows).not.toHaveBeenCalled()
  })
})
