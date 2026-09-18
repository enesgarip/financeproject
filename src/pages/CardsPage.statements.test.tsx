// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, CardExpense } from '../types/database'

vi.mock('../hooks/useBalancePrivacy', () => ({
  useBalancePrivacy: () => ({ formatAmount: (value: number) => `${value.toFixed(2)} TL` }),
}))

import { ProvisionPanel } from './CardsPage.statements'

afterEach(cleanup)

function card(id: string, bankName: string, cardName: string): Card {
  return {
    id, user_id: 'u1', bank_name: bankName, card_name: cardName,
    holder_name: null, account_number: null, iban: null, card_type: 'kredi_karti',
    limit_group_name: null, credit_limit: 10_000, debt_amount: 0,
    statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0,
    current_balance: 0, statement_day: 1, due_day: 10, note: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  }
}

function provision(id: string, cardId: string, description: string, amount: number): CardExpense {
  return {
    id, user_id: 'u1', card_id: cardId, statement_archive_id: null,
    current_settlement_id: null, spent_at: '2026-09-18', amount, description,
    category: 'Diğer', installment_count: 1, installment_amount: amount,
    status: 'provision', posted_at: null, note: null,
    transaction_fingerprint: null, source: 'manual', source_event_id: null,
    created_at: '2026-09-18', updated_at: '2026-09-18',
  }
}

describe('ProvisionPanel kart filtresi', () => {
  it('listeyi, toplamı ve toplu aktarmayı seçili kartla sınırlar', () => {
    const firstCard = card('c1', 'Banka A', 'Kart A')
    const secondCard = card('c2', 'Banka B', 'Kart B')
    const firstProvision = provision('p1', firstCard.id, 'Market', 100)
    const secondProvision = provision('p2', secondCard.id, 'Akaryakıt', 250)
    const onPostAll = vi.fn()

    render(
      <ProvisionPanel
        rows={[firstCard, secondCard]}
        provisions={[firstProvision, secondProvision]}
        loading={false}
        actionId={null}
        onPost={vi.fn()}
        onPostAll={onPostAll}
        onCancel={vi.fn()}
        onSetInstallments={vi.fn()}
      />,
    )

    expect(screen.getByText('350.00 TL')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Provizyonları karta göre filtrele'), { target: { value: secondCard.id } })

    expect(screen.queryByText('Market')).toBeNull()
    expect(screen.getByText('Akaryakıt')).toBeTruthy()
    expect(screen.getAllByText('250.00 TL')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Tümünü aktar' }))
    expect(onPostAll).toHaveBeenCalledWith([secondProvision])
  })
})
