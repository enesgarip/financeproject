import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCardExpense,
  fetchCardInstallmentMatchRows,
  payPaymentFromCardImport,
  recordCardInstallmentCarryover,
  setProvisionInstallments,
  updateCardExpenseHealthMetadata,
} from './cardsRepo'

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: supabaseMocks.rpc,
    from: supabaseMocks.from,
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

describe('cardsRepo statement installment read safety', () => {
  beforeEach(() => {
    supabaseMocks.from.mockReset()
  })

  it('loads the statement marker needed to label historical mismatches', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [], error: null })
    const select = vi.fn(() => ({ eq }))
    supabaseMocks.from.mockReturnValue({ select })

    const result = await fetchCardInstallmentMatchRows('card-1')

    expect(result.ok).toBe(true)
    expect(supabaseMocks.from).toHaveBeenCalledWith('card_installments')
    expect(select).toHaveBeenCalledWith(
      'id, due_month, amount, status, description, installment_no, installment_count, statement_archive_id',
    )
    expect(eq).toHaveBeenCalledWith('card_id', 'card-1')
  })

})

describe('cardsRepo.setProvisionInstallments', () => {
  function mockUpdateChain() {
    const statusEq = vi.fn().mockResolvedValue({ error: null })
    const idEq = vi.fn(() => ({ eq: statusEq }))
    const update = vi.fn(() => ({ eq: idEq }))
    supabaseMocks.from.mockReturnValue({ update })
    return { update, idEq, statusEq }
  }

  beforeEach(() => {
    supabaseMocks.from.mockReset()
  })

  it('yalnız provizyon satırında taksit adedini ve bölünmüş tutarı yazar', async () => {
    const { update, idEq, statusEq } = mockUpdateChain()

    const result = await setProvisionInstallments('expense-1', 300, 3)

    expect(result.ok).toBe(true)
    expect(supabaseMocks.from).toHaveBeenCalledWith('card_expenses')
    expect(update).toHaveBeenCalledWith({ installment_count: 3, installment_amount: 100 })
    expect(idEq).toHaveBeenCalledWith('id', 'expense-1')
    expect(statusEq).toHaveBeenCalledWith('status', 'provision')
  })

  it('tek çekimde taksit tutarı toplam tutara eşittir', async () => {
    const { update } = mockUpdateChain()

    await setProvisionInstallments('expense-1', 249.9, 1)

    expect(update).toHaveBeenCalledWith({ installment_count: 1, installment_amount: 249.9 })
  })

  it('taksit adedini 1..36 aralığına sıkıştırır', async () => {
    const { update } = mockUpdateChain()

    await setProvisionInstallments('expense-1', 120, 99)

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ installment_count: 36 }))
  })
})

describe('cardsRepo Data Health metadata contract', () => {
  it('sends only user-confirmed metadata and the optimistic row version', async () => {
    supabaseMocks.rpc.mockReset()
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: null })

    const result = await updateCardExpenseHealthMetadata({
      expenseId: 'expense-1',
      description: 'Market alışverişi',
      category: 'Market',
      expectedUpdatedAt: '2026-08-03T08:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      'update_card_expense_health_metadata',
      {
        p_expense_id: 'expense-1',
        p_description: 'Market alışverişi',
        p_category: 'Market',
        p_expected_updated_at: '2026-08-03T08:00:00.000Z',
      },
    )
  })
})
