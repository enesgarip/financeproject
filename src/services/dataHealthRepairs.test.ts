import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import { applyDataHealthSafeRepairs } from './dataHealthRepairs'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

const rpcMock = vi.mocked(supabase.rpc)
const idempotencyKey = '11111111-1111-4111-8111-111111111111'
const repair = {
  rule: 'card_ledger_recompute' as const,
  targetId: '22222222-2222-4222-8222-222222222222',
  expectedUpdatedAt: '2026-08-03T08:00:00.000Z',
}

beforeEach(() => {
  rpcMock.mockReset()
})

describe('applyDataHealthSafeRepairs', () => {
  it('sends the complete optimistic plan with the caller idempotency key', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        runId: '33333333-3333-4333-8333-333333333333',
        status: 'succeeded',
        planned: 1,
        applied: 1,
        skipped: 0,
        message: null,
        idempotentReplay: false,
      },
      error: null,
    } as never)

    const result = await applyDataHealthSafeRepairs([repair], idempotencyKey)

    expect(rpcMock).toHaveBeenCalledWith('apply_data_health_safe_repairs', {
      p_repairs: [repair],
      p_idempotency_key: idempotencyKey,
    })
    expect(result).toEqual({
      receipt: expect.objectContaining({
        status: 'succeeded',
        applied: 1,
        idempotentReplay: false,
      }),
      error: null,
    })
  })

  it('preserves an idempotent replay receipt', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        runId: '33333333-3333-4333-8333-333333333333',
        status: 'succeeded',
        planned: 1,
        applied: 1,
        skipped: 0,
        message: null,
        idempotentReplay: true,
      },
      error: null,
    } as never)

    const result = await applyDataHealthSafeRepairs([repair], idempotencyKey)

    expect(result.receipt?.idempotentReplay).toBe(true)
  })

  it('rejects a malformed server receipt instead of treating it as success', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { status: 'succeeded', applied: 1 },
      error: null,
    } as never)

    const result = await applyDataHealthSafeRepairs([repair], idempotencyKey)

    expect(result.receipt).toBeNull()
    expect(result.error?.message).toContain('geçersiz bir sonuç')
  })

  it('returns the Supabase error without fabricating a receipt', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    } as never)

    const result = await applyDataHealthSafeRepairs([repair], idempotencyKey)

    expect(result).toEqual({
      receipt: null,
      error: { code: '42501', message: 'permission denied' },
    })
  })
})
