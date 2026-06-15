import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addCardExpense } from './cardsRepo'

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
  },
}))

describe('cardsRepo.addCardExpense', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset()
  })

  const input = {
    cardId: 'card-1',
    amount: 125,
    description: 'Market',
    spentAt: '2026-06-15',
    category: 'Market',
    installmentCount: 1,
    status: 'posted' as const,
  }

  it('calls the canonical add_card_expense RPC signature', async () => {
    supabaseMocks.rpc.mockResolvedValue({ error: null })

    const result = await addCardExpense(input)

    expect(result.ok).toBe(true)
    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('add_card_expense', {
      p_card_id: 'card-1',
      p_amount: 125,
      p_description: 'Market',
      p_spent_at: '2026-06-15',
      p_category: 'Market',
      p_installment_count: 1,
      p_status: 'posted',
    })
  })

  it('does not retry the retired legacy RPC signature on missing capability', async () => {
    supabaseMocks.rpc.mockResolvedValue({
      error: { code: 'PGRST202', message: 'Could not find the function public.add_card_expense in the schema cache' },
    })

    const result = await addCardExpense(input)

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected missing capability error')
    expect(result.error.type).toBe('missing-capability')
    expect(result.error.code).toBe('PGRST202')
  })
})
