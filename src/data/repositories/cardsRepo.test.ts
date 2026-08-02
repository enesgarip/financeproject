import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addCardExpense, payPaymentFromCardImport, recordCardInstallmentCarryover } from './cardsRepo'

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
      p_source: 'manual',
      p_source_event_id: null,
    })
  })

  it('kaynak verilmezse manual, verilirse geçileni gönderir', async () => {
    supabaseMocks.rpc.mockResolvedValue({ error: null })

    await addCardExpense({ ...input, source: 'statement_import' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'add_card_expense',
      expect.objectContaining({ p_source: 'statement_import' }),
    )
  })

  it('kaynak olay kimliğini canonical RPC imzasına geçirir', async () => {
    supabaseMocks.rpc.mockResolvedValue({ error: null })

    await addCardExpense({ ...input, source: 'sms', sourceEventId: 'sms-event-1' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'add_card_expense',
      expect.objectContaining({ p_source: 'sms', p_source_event_id: 'sms-event-1' }),
    )
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

describe('cardsRepo import source-event RPC contracts', () => {
  beforeEach(() => {
    supabaseMocks.rpc.mockReset()
    supabaseMocks.rpc.mockResolvedValue({ error: null })
  })

  it('planned payment importunda olay kimliği ve import kaynağını gönderir', async () => {
    await payPaymentFromCardImport({
      paymentId: 'payment-1',
      sourceCardId: 'card-1',
      amount: 250,
      spentAt: '2026-08-02',
      sourceEventId: 'pdf-hash:4',
      source: 'movement_import',
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('pay_payment_from_card_import', {
      p_payment_id: 'payment-1',
      p_source_card_id: 'card-1',
      p_paid_amount: 250,
      p_spent_at: '2026-08-02',
      p_source_event_id: 'pdf-hash:4',
      p_source: 'movement_import',
    })
  })

  it('taksit devrinde olay kimliğini gönderir', async () => {
    await recordCardInstallmentCarryover({
      cardId: 'card-1',
      description: 'Telefon',
      installmentAmount: 100,
      totalInstallments: 3,
      paidInstallments: 1,
      nextDueDate: '2026-08-02',
      category: 'Alışveriş',
      sourceEventId: 'request-1',
    })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('record_card_installment_carryover', {
      p_card_id: 'card-1',
      p_description: 'Telefon',
      p_installment_amount: 100,
      p_total_installments: 3,
      p_paid_installments: 1,
      p_next_due_month: '2026-08-02',
      p_category: 'Alışveriş',
      p_source_event_id: 'request-1',
    })
  })
})
