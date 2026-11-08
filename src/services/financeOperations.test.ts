// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeFinanceOperation } from './financeOperations'
import { operationKey, pendingOperations } from '../utils/operationAttempt'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
const method = 'contribute_to_goal_bucket' as const
const args = { p_bucket_id: 'bucket', p_amount: 100 }
beforeEach(() => { vi.unstubAllGlobals(); localStorage.clear(); vi.restoreAllMocks(); mocks.rpc.mockReset() })
describe('kalıcı işlem niyeti ve makbuz', () => {
  it('kayıp yanıttan sonra aynı UUID kullanılır; başarıdan sonraki bilinçli ayırma yenidir', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } }).mockResolvedValue({ error: null })
    expect((await executeFinanceOperation('u', method, 'bucket', args)).error?.message).toContain('uygulanmış olabilir')
    const request = mocks.rpc.mock.calls[0][1].p_request_id
    expect(pendingOperations('u')).toHaveLength(1)
    expect(pendingOperations('other')).toHaveLength(0)
    await executeFinanceOperation('u', method, 'bucket', args)
    expect(mocks.rpc.mock.calls[1][1].p_request_id).toBe(request)
    expect(pendingOperations('u')).toHaveLength(0)
    await executeFinanceOperation('u', method, 'bucket', args)
    expect(mocks.rpc.mock.calls[2][1].p_request_id).not.toBe(request)
  })
  it('sonuç belirsizken farklı tutar ile yeni istek göndermez', async () => {
    mocks.rpc.mockRejectedValue(new Error('network timeout'))
    await executeFinanceOperation('u', method, 'bucket', args)
    const result = await executeFinanceOperation('u', method, 'bucket', { ...args, p_amount: 200 })
    expect(result.error?.code).toBe('LOCAL_INTENT')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('storage bloke veya bozukken para yazmaz', async () => {
    localStorage.setItem(operationKey('u', method, 'bucket'), '{broken')
    expect((await executeFinanceOperation('u', method, 'bucket', args)).error?.code).toBe('LOCAL_INTENT')
    expect(mocks.rpc).not.toHaveBeenCalled()
    localStorage.clear()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('SecurityError') } })
    expect((await executeFinanceOperation('u', method, 'bucket', args)).error?.code).toBe('LOCAL_INTENT')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('kesin SQL reddinde niyeti temizler; restore payloadını cihazda saklamaz', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'Yetersiz bakiye' } })
    await executeFinanceOperation('u', method, 'bucket', args)
    expect(pendingOperations('u')).toHaveLength(0)
    mocks.rpc.mockResolvedValue({ error: { message: 'Failed to fetch' } })
    await executeFinanceOperation('u', 'restore_user_finance_data_tx', 'restore', { p_payload: { tables: { assets: [{ name: 'private secret' }] } } })
    expect(JSON.stringify(pendingOperations('u'))).not.toContain('private secret')
    expect(pendingOperations('u')[0].args).toBeUndefined()
  })
})
