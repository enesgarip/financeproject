import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUndoEntry, captureUndoRows } from './DataHealth.actions'

const mocks = vi.hoisted(() => ({
  deleteDataHealthRows: vi.fn(),
  fetchUndoRows: vi.fn(),
  restoreDataHealthFields: vi.fn(),
}))

vi.mock('../data/repositories/dataHealthRepo', () => ({
  deleteDataHealthRows: mocks.deleteDataHealthRows,
  fetchUndoRows: mocks.fetchUndoRows,
  restoreDataHealthFields: mocks.restoreDataHealthFields,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchUndoRows.mockResolvedValue({ ok: true, data: [] })
  mocks.restoreDataHealthFields.mockResolvedValue({ ok: true, data: undefined })
})

describe('Data Health session undo safety', () => {
  it('restores only changed fields with the exact post-fix row version', async () => {
    await applyUndoEntry({
      action: 'restoreRows',
      table: 'payments',
      rows: [{
        id: 'payment-1',
        user_id: 'user-1',
        due_date: '2026-08-10',
        amount: 500,
        status: 'bekliyor',
      }],
      fields: ['due_date'],
      expectedUpdatedAtById: {
        'payment-1': '2026-08-03T09:00:00.000Z',
      },
    })

    expect(mocks.restoreDataHealthFields).toHaveBeenCalledWith(
      'payments',
      'payment-1',
      { due_date: '2026-08-10' },
      '2026-08-03T09:00:00.000Z',
    )
  })

  it('refuses a legacy full-row undo without safe field and version metadata', async () => {
    await expect(applyUndoEntry({
      action: 'restoreRows',
      table: 'payments',
      rows: [{ id: 'payment-1', amount: 500 }],
    })).rejects.toThrow('güvenli sürüm bilgisi içermiyor')

    expect(mocks.restoreDataHealthFields).not.toHaveBeenCalled()
  })

  it('surfaces a CAS conflict instead of overwriting a later edit', async () => {
    mocks.restoreDataHealthFields.mockResolvedValueOnce({
      ok: false,
      error: { type: 'unknown', message: 'Kayıt düzeltmeden sonra değişmiş; geri alma uygulanmadı.' },
    })

    await expect(applyUndoEntry({
      action: 'restoreRows',
      table: 'payments',
      rows: [{ id: 'payment-1', due_date: '2026-08-10' }],
      fields: ['due_date'],
      expectedUpdatedAtById: {
        'payment-1': '2026-08-03T09:00:00.000Z',
      },
    })).rejects.toThrow('düzeltmeden sonra değişmiş')
  })

  it('requires a complete snapshot before a guarded write can start', async () => {
    mocks.fetchUndoRows.mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'row-1' }],
    })

    await expect(captureUndoRows('budgets', ['row-1', 'row-2']))
      .rejects.toThrow('anlık görüntüsü eksik')
  })
})
