import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card } from '../types/database'
import { supabase } from '../lib/supabase'
import {
  getAccountsForObligation,
  estimatedMinimumCardPayment,
  lastUsedKeyForObligation,
  obligationAmountEditable,
  submitFinanceObligationPayment,
  submitLabelForObligation,
} from './financePaymentActions'
import type { FinanceObligation } from '../utils/obligations'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const rpcMock = vi.mocked(supabase.rpc)

beforeEach(() => {
  rpcMock.mockReset()
})

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'banka_karti',
    holder_name: null, account_number: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 0,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: null,
    due_day: null,
    note: null,
    ...overrides,
  }
}

function obligation(overrides: Partial<FinanceObligation>): FinanceObligation {
  return {
    id: 'obligation',
    kind: 'payment',
    action: 'pay_payment',
    sourceId: 'source',
    title: 'Odeme',
    subtitle: 'Kategori',
    date: '2026-06-10',
    amount: 100,
    direction: 'outflow',
    ...overrides,
  }
}

describe('finance payment action helpers', () => {
  it('allows planned payments from bank accounts or credit cards', () => {
    const accounts = getAccountsForObligation(
      obligation({ action: 'pay_payment' }),
      [
        card({ id: 'credit', card_type: 'kredi_karti', card_name: 'Kredi' }),
        card({ id: 'bank', card_type: 'banka_karti', card_name: 'Banka' }),
      ],
    )

    expect(accounts.map((account) => account.id)).toEqual(['bank', 'credit'])
  })

  it('limits statement and debt payments to bank accounts outside the related card', () => {
    const accounts = getAccountsForObligation(
      obligation({ kind: 'card_statement', action: 'pay_card_statement', relatedCardId: 'credit' }),
      [
        card({ id: 'bank', card_type: 'banka_karti' }),
        card({ id: 'credit', card_type: 'kredi_karti' }),
      ],
    )

    expect(accounts.map((account) => account.id)).toEqual(['bank'])
  })

  it('keeps amount editing limited to actions that support actual amount changes', () => {
    expect(obligationAmountEditable(obligation({ action: 'pay_payment' }))).toBe(true)
    expect(obligationAmountEditable(obligation({ kind: 'card_debt', action: 'pay_card_debt' }))).toBe(true)
    // K7: ekstre de kısmi/asgari ödenebilir (append-only card_statement_payments).
    expect(obligationAmountEditable(obligation({ kind: 'card_statement', action: 'pay_card_statement' }))).toBe(true)
    // Kredi taksidi hâlâ tam tutar: taksit planı bölünmez.
    expect(obligationAmountEditable(obligation({ kind: 'loan_installment', action: 'pay_loan_installment' }))).toBe(false)
  })

  it('keeps last-used account memory separated by obligation family', () => {
    expect(lastUsedKeyForObligation(obligation({ action: 'pay_loan_installment' }))).toBe('loanAccount')
    expect(lastUsedKeyForObligation(obligation({ action: 'settle_debt' }))).toBe('debtAccount')
    expect(submitLabelForObligation(obligation({ action: 'pay_card_statement' }))).toBe('Ekstreyi öde')
  })

  it('does not retry pay_payment with a retired RPC signature when deployment is missing', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.pay_payment' },
    } as never)

    const result = await submitFinanceObligationPayment({
      obligation: obligation({ action: 'pay_payment' }),
      account: card({ id: 'bank' }),
      amount: 125,
    })

    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(rpcMock).toHaveBeenCalledWith('pay_payment', {
      p_payment_id: 'source',
      p_source_card_id: 'bank',
      p_paid_amount: 125,
    })
    expect(result.error?.message).toContain('PGRST202')
  })

  it('sends p_amount only when the statement payment is partial (K7)', async () => {
    const statement = obligation({ kind: 'card_statement', action: 'pay_card_statement', amount: 1_000 })

    rpcMock.mockResolvedValueOnce({ data: null, error: null } as never)
    await submitFinanceObligationPayment({ obligation: statement, account: card({ id: 'bank' }), amount: 400 })
    expect(rpcMock).toHaveBeenLastCalledWith('pay_card_statement', {
      p_statement_id: 'source',
      p_source_card_id: 'bank',
      p_skip_source_debit: false,
      p_amount: 400,
    })

    // Kalanın tamamı: p_amount GÖNDERİLMEZ → sunucu tam kapama yapar.
    rpcMock.mockResolvedValueOnce({ data: null, error: null } as never)
    await submitFinanceObligationPayment({ obligation: statement, account: card({ id: 'bank' }), amount: 1_000 })
    expect(rpcMock).toHaveBeenLastCalledWith('pay_card_statement', {
      p_statement_id: 'source',
      p_source_card_id: 'bank',
      p_skip_source_debit: false,
    })

    // Kuruş altı fark tam ödeme sayılır (float tozu kısmi ödemeye düşmez).
    rpcMock.mockResolvedValueOnce({ data: null, error: null } as never)
    await submitFinanceObligationPayment({
      obligation: obligation({ kind: 'card_statement', action: 'pay_card_statement', amount: 1_000.0000001 }),
      account: card({ id: 'bank' }),
      amount: 1_000,
    })
    expect(rpcMock).toHaveBeenLastCalledWith('pay_card_statement', {
      p_statement_id: 'source',
      p_source_card_id: 'bank',
      p_skip_source_debit: false,
    })
  })

  it('computes the estimated minimum card payment with TL rounding', () => {
    expect(estimatedMinimumCardPayment(1000)).toBe(200)
    expect(estimatedMinimumCardPayment(333.33)).toBe(66.67)
    expect(estimatedMinimumCardPayment(-100)).toBe(0)
  })
})
