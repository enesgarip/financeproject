// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { Card, CardExpense } from '../types/database'
import type { HealthIssue } from './DataHealth.logic'

vi.mock('../components/SimpleModal', () => ({
  SimpleModal: ({ children, open, title }: { children: ReactNode; open: boolean; title: string }) => (
    open ? <section aria-label={title}>{children}</section> : null
  ),
}))

vi.mock('../hooks/useBalancePrivacy', () => ({
  useBalancePrivacy: () => ({
    hidden: false,
    toggleHidden: vi.fn(),
    formatAmount: (value: number | null | undefined) => `${(value ?? 0).toFixed(2)} TL`,
  }),
}))

import { DataHealthCardExpenseReview } from './DataHealthCardExpenseReview'

afterEach(cleanup)

const card: Card = {
  id: 'card-1',
  user_id: 'user-1',
  created_at: '2026-08-01T08:00:00.000Z',
  updated_at: '2026-08-01T08:00:00.000Z',
  bank_name: 'DenizBank',
  card_name: 'Bonus',
  card_type: 'kredi_karti',
  holder_name: null,
  account_number: null,
  iban: null,
  limit_group_name: null,
  current_balance: 0,
  credit_limit: 50_000,
  debt_amount: 250,
  statement_debt_amount: 0,
  current_period_spending: 250,
  provision_amount: 0,
  statement_day: 15,
  due_day: 25,
  note: null,
}

function expense(overrides: Partial<CardExpense> & Pick<CardExpense, 'id'>): CardExpense {
  return {
    user_id: 'user-1',
    created_at: '2026-08-01T08:00:00.000Z',
    updated_at: '2026-08-02T09:00:00.000Z',
    card_id: card.id,
    statement_archive_id: null,
    current_settlement_id: null,
    spent_at: '2026-08-01',
    amount: 125,
    description: 'Migros',
    category: 'Market',
    installment_count: 1,
    installment_amount: 125,
    status: 'posted',
    posted_at: '2026-08-01T12:00:00.000Z',
    note: null,
    transaction_fingerprint: 'fingerprint-1',
    source: 'manual',
    source_event_id: null,
    ...overrides,
    id: overrides.id,
  }
}

function issue(kind: HealthIssue['kind'], id: string, ids: string[]): HealthIssue {
  return {
    id,
    area: 'Kartlar',
    severity: 'warning',
    title: 'Kart harcaması incelemesi',
    description: 'Aday kayıtları kontrol et.',
    details: [],
    fixable: false,
    kind,
    payload: { ids },
  }
}

function renderReview({
  targetIssue,
  expenses,
  onCancelDuplicate = vi.fn<(expenseId: string) => void>(),
  onUpdateMetadata = vi.fn<(input: {
    expenseId: string
    description: string
    category: string
    expectedUpdatedAt: string
  }) => void>(),
}: {
  targetIssue: HealthIssue
  expenses: CardExpense[]
  onCancelDuplicate?: (expenseId: string) => void
  onUpdateMetadata?: (input: {
    expenseId: string
    description: string
    category: string
    expectedUpdatedAt: string
  }) => void
}) {
  render(
    <MemoryRouter>
      <DataHealthCardExpenseReview
        issue={targetIssue}
        expenses={expenses}
        cards={[card]}
        busy={false}
        error=""
        onClose={vi.fn()}
        onCancelDuplicate={onCancelDuplicate}
        onUpdateMetadata={onUpdateMetadata}
      />
    </MemoryRouter>,
  )
  return { onCancelDuplicate, onUpdateMetadata }
}

describe('DataHealthCardExpenseReview duplicate flow', () => {
  it('requires candidate selection and explicit comparison confirmation before cancellation', () => {
    const first = expense({ id: 'expense-1' })
    const second = expense({ id: 'expense-2', transaction_fingerprint: 'fingerprint-2' })
    const { onCancelDuplicate } = renderReview({
      targetIssue: issue(
        'duplicateTransactionCandidate',
        'card-expense-duplicate-exact-expense-1-expense-2',
        [first.id, second.id],
      ),
      expenses: [first, second],
    })
    const cancelButton = screen.getByRole('button', { name: 'Seçili tekrar kaydını iptal et' }) as HTMLButtonElement

    expect(screen.getByRole('region', { name: 'Tekrarlanan harcamaları karşılaştır' })).toBeTruthy()
    expect(screen.getAllByText('DenizBank · Bonus')).toHaveLength(2)
    expect(screen.getAllByText('125.00 TL')).toHaveLength(2)
    expect(screen.getByText('İşlem parmak izi: fingerprint-1')).toBeTruthy()
    expect(cancelButton.disabled).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'Aday 2: Migros' }))
    expect(cancelButton.disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Kayıtları karşılaştırdım' }))
    expect(cancelButton.disabled).toBe(false)
    fireEvent.click(cancelButton)

    expect(onCancelDuplicate).toHaveBeenCalledTimes(1)
    expect(onCancelDuplicate).toHaveBeenCalledWith(second.id)
  })

  it('requires a fresh comparison confirmation when the selected candidate changes', () => {
    const first = expense({ id: 'expense-1' })
    const second = expense({ id: 'expense-2', transaction_fingerprint: 'fingerprint-2' })
    renderReview({
      targetIssue: issue(
        'duplicateTransactionCandidate',
        'card-expense-duplicate-exact-expense-1-expense-2',
        [first.id, second.id],
      ),
      expenses: [first, second],
    })
    const confirmation = screen.getByRole('checkbox', { name: 'Kayıtları karşılaştırdım' }) as HTMLInputElement
    const cancelButton = screen.getByRole('button', { name: 'Seçili tekrar kaydını iptal et' }) as HTMLButtonElement

    fireEvent.click(screen.getByRole('radio', { name: 'Aday 1: Migros' }))
    fireEvent.click(confirmation)
    expect(cancelButton.disabled).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: 'Aday 2: Migros' }))
    expect(confirmation.checked).toBe(false)
    expect(cancelButton.disabled).toBe(true)
  })
})

describe('DataHealthCardExpenseReview metadata flow', () => {
  it('sends normalized metadata with the selected row version only after blank fields are fixed', () => {
    const target = expense({
      id: 'expense-metadata',
      description: '',
      category: '',
      updated_at: '2026-08-03T10:15:00.000Z',
    })
    const { onUpdateMetadata } = renderReview({
      targetIssue: issue(
        'cardExpenseDataQuality',
        'card-expense-missing-description',
        [target.id],
      ),
      expenses: [target],
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Aday 1: Açıklama eksik' }))
    const saveButton = screen.getByRole('button', { name: 'Değişiklikleri kaydet' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Açıklama' }), {
      target: { value: '  Migros alışverişi  ' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Kategori' }), {
      target: { value: 'Market' },
    })
    expect(saveButton.disabled).toBe(false)
    fireEvent.click(saveButton)

    expect(onUpdateMetadata).toHaveBeenCalledTimes(1)
    expect(onUpdateMetadata).toHaveBeenCalledWith({
      expenseId: target.id,
      description: 'Migros alışverişi',
      category: 'Market',
      expectedUpdatedAt: target.updated_at,
    })
  })
})
