import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import { reconcileCardBankSnapshot } from './cardLedgerActions'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

const rpcMock = vi.mocked(supabase.rpc)

beforeEach(() => {
  rpcMock.mockReset()
})

describe('card bank snapshot reconciliation', () => {
  it('sends the bank total as integer kuruş and trims the audit note', async () => {
    rpcMock.mockResolvedValueOnce({ data: 83614.83, error: null } as never)

    const result = await reconcileCardBankSnapshot('card-id', 83614.83, '  YapıKredi ekranı  ')

    expect(rpcMock).toHaveBeenCalledWith('reconcile_card_bank_snapshot', {
      p_card_id: 'card-id',
      p_bank_total_kurus: 8361483,
      p_note: 'YapıKredi ekranı',
    })
    expect(result).toEqual({ debt: 83614.83, error: null })
  })

  it('rejects a negative bank total without calling the database', async () => {
    const result = await reconcileCardBankSnapshot('card-id', -0.01, 'not')

    expect(rpcMock).not.toHaveBeenCalled()
    expect(result.error?.message).toContain('negatif olamaz')
  })
})
