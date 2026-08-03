import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeDataHealthIssues,
  clearDataHealthIssueAcknowledgements,
  restoreDataHealthFields,
  updateDataHealthRow,
} from './dataHealthRepo'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}))

const expectedUpdatedAt = '2026-08-03T08:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
  const builder = {
    update: mocks.update,
    eq: mocks.eq,
    select: mocks.select,
  }
  mocks.from.mockReturnValue(builder)
  mocks.update.mockReturnValue(builder)
  mocks.eq.mockReturnValue(builder)
  mocks.select.mockResolvedValue({
    data: [{ id: 'row-1', updated_at: '2026-08-03T09:00:00.000Z' }],
    error: null,
  })
})

describe('data health optimistic writes', () => {
  it('updates a single row only when updated_at still matches the scan', async () => {
    const result = await updateDataHealthRow(
      'assets',
      'row-1',
      { unit: 'TRY' },
      expectedUpdatedAt,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected optimistic update success')
    expect(result.data).toEqual({
      id: 'row-1',
      updatedAt: '2026-08-03T09:00:00.000Z',
    })
    expect(mocks.eq).toHaveBeenNthCalledWith(1, 'id', 'row-1')
    expect(mocks.eq).toHaveBeenNthCalledWith(2, 'updated_at', expectedUpdatedAt)
    expect(mocks.select).toHaveBeenCalledWith('id, updated_at')
  })

  it('reports a stale single-row snapshot when no row is affected', async () => {
    mocks.select.mockResolvedValueOnce({ data: [], error: null })

    const result = await updateDataHealthRow(
      'assets',
      'row-1',
      { unit: 'TRY' },
      expectedUpdatedAt,
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected optimistic update failure')
    expect(result.error.message).toContain('Kayıt değişmiş')
  })

  it('restores only selected fields when the post-fix version still matches', async () => {
    const result = await restoreDataHealthFields(
      'payments',
      'row-1',
      { due_date: '2026-08-10' },
      '2026-08-03T09:00:00.000Z',
    )

    expect(result.ok).toBe(true)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ due_date: '2026-08-10' }),
    )
    expect(mocks.eq).toHaveBeenNthCalledWith(1, 'id', 'row-1')
    expect(mocks.eq).toHaveBeenNthCalledWith(2, 'updated_at', '2026-08-03T09:00:00.000Z')
  })

  it('reports a conflict instead of overwriting a row changed after the fix', async () => {
    mocks.select.mockResolvedValueOnce({ data: [], error: null })

    const result = await restoreDataHealthFields(
      'payments',
      'row-1',
      { due_date: '2026-08-10' },
      '2026-08-03T09:00:00.000Z',
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected undo version conflict')
    expect(result.error.message).toContain('düzeltmeden sonra değişmiş')
  })

  it('rejects immutable fields before issuing an undo write', async () => {
    const result = await restoreDataHealthFields(
      'payments',
      'row-1',
      { user_id: 'other-user' },
      '2026-08-03T09:00:00.000Z',
    )

    expect(result.ok).toBe(false)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

describe('data health issue acknowledgements', () => {
  it('deduplicates IDs and chunks legacy browser migration writes at 500', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    const ids = Array.from({ length: 501 }, (_, index) => `issue-${index}`)

    const result = await acknowledgeDataHealthIssues([...ids, ' issue-0 '])

    expect(result.ok).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'acknowledge_data_health_issues', {
      p_issue_ids: ids.slice(0, 500),
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'acknowledge_data_health_issues', {
      p_issue_ids: ids.slice(500),
    })
  })

  it('clears only through the auth-bound server RPC', async () => {
    mocks.rpc.mockResolvedValue({ error: null })

    const result = await clearDataHealthIssueAcknowledgements()

    expect(result.ok).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('clear_data_health_issue_acknowledgements', {})
  })

  it('surfaces an acknowledgement RPC failure without pretending success', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '42501', message: 'denied' } })

    const result = await acknowledgeDataHealthIssues(['issue-1'])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected acknowledgement failure')
    expect(result.error.message).toBe('denied')
  })
})
