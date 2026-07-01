import { describe, expect, it } from 'vitest'
import type { Card } from '../types/database'
import { mapCardForm } from './CardsPage.crud'

function creditCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    user_id: 'user-1',
    bank_name: 'Test Bank',
    card_name: 'Kart',
    holder_name: null, account_number: null,
    iban: null,
    card_type: 'kredi_karti',
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 10000,
    debt_amount: 1200,
    statement_debt_amount: 1000,
    current_period_spending: 200,
    provision_amount: 0,
    statement_day: 1,
    due_day: 10,
    note: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  }
}

function bankCard(overrides: Partial<Card> = {}): Card {
  return creditCard({
    card_type: 'banka_karti',
    current_balance: 5000,
    credit_limit: 0,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: null,
    due_day: null,
    ...overrides,
  })
}

function form(values: Record<string, string | number | null>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value == null ? '' : String(value))
  }
  return data
}

function cardForm(card: Card, overrides: Record<string, string | number | null> = {}) {
  return form({
    bank_name: card.bank_name,
    card_name: card.card_name,
    card_type: card.card_type,
    holder_name: card.holder_name,
    account_number: card.account_number,
    iban: card.iban ?? null,
    limit_group_name: card.limit_group_name,
    current_balance: card.current_balance,
    credit_limit: card.credit_limit,
    statement_debt_amount: card.statement_debt_amount,
    current_period_spending: card.current_period_spending,
    provision_amount: card.provision_amount,
    statement_day: card.statement_day,
    due_day: card.due_day,
    note: card.note,
    ...overrides,
  })
}

describe('mapCardForm', () => {
  it('does not send unchanged credit-card debt fields on edit', () => {
    const editing = creditCard()

    const payload = mapCardForm(cardForm(editing, { card_name: 'Yeni ad' }), 'user-1', editing)

    expect(payload.card_name).toBe('Yeni ad')
    expect('debt_amount' in payload).toBe(false)
    expect('statement_debt_amount' in payload).toBe(false)
    expect('current_period_spending' in payload).toBe(false)
    expect('provision_amount' in payload).toBe(false)
  })

  it('sends credit-card debt fields when the split changes', () => {
    const editing = creditCard()

    const payload = mapCardForm(cardForm(editing, { current_period_spending: 250 }), 'user-1', editing)

    expect(payload.debt_amount).toBe(1250)
    expect(payload.statement_debt_amount).toBe(1000)
    expect(payload.current_period_spending).toBe(250)
    expect(payload.provision_amount).toBe(0)
  })

  it('does not send unchanged bank balance on edit', () => {
    const editing = bankCard()

    const payload = mapCardForm(cardForm(editing, { card_name: 'Yeni hesap adı' }), 'user-1', editing)

    expect(payload.card_name).toBe('Yeni hesap adı')
    expect('current_balance' in payload).toBe(false)
  })
})
