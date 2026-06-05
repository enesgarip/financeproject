import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import {
  getAccountsForObligation,
  lastUsedKeyForObligation,
  obligationAmountEditable,
  submitLabelForObligation,
} from './financePaymentActions'
import type { FinanceObligation } from '../utils/obligations'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }

function card(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'banka_karti',
    holder_name: null,
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
    expect(obligationAmountEditable(obligation({ kind: 'card_statement', action: 'pay_card_statement' }))).toBe(false)
  })

  it('keeps last-used account memory separated by obligation family', () => {
    expect(lastUsedKeyForObligation(obligation({ action: 'pay_loan_installment' }))).toBe('loanAccount')
    expect(lastUsedKeyForObligation(obligation({ action: 'settle_debt' }))).toBe('debtAccount')
    expect(submitLabelForObligation(obligation({ action: 'pay_card_statement' }))).toBe('Ekstreyi öde')
  })
})
