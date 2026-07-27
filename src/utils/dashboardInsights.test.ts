import { describe, expect, it } from 'vitest'
import type { Card, CardInstallment } from '../types/database'
import { buildFocusActions, type FocusActionsInput } from './dashboardInsights'
import type { CashFlowSummary } from './financeSummary'

const cashFlow = (over: Partial<CashFlowSummary> = {}): CashFlowSummary =>
  ({ monthLabel: 'Haziran 2026', projectedCash: 10_000, netFlow: 2_000, ...over }) as CashFlowSummary


const base = { id: 'id', user_id: 'u', created_at: '2026-06-01', updated_at: '2026-06-01' }
function card(over: Partial<Card> & Pick<Card, 'card_type'>): Card {
  return {
    ...base,
    bank_name: 'B',
    card_name: 'K',
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
    ...over,
  }
}

function cardInstallment(over: Partial<CardInstallment>): CardInstallment {
  return {
    ...base,
    card_id: 'credit-1',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 1,
    due_month: '2026-06-01',
    amount: 0,
    description: 'Taksit',
    category: 'Genel',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    ...over,
  }
}

const emptyInput: FocusActionsInput = {
  cards: [],
  payments: [],
  loans: [],
  loanInstallments: [],
  cardInstallments: [],
  cardStatements: [],
  salaryHistory: [],
  accountReconciliations: [],
}

describe('buildFocusActions', () => {
  it('prioritises adding a bank account when none exists', () => {
    const actions = buildFocusActions(emptyInput, cashFlow(), 0, [])
    expect(actions[0].id).toBe('setup-bank-account')
  })

  it('falls back to the all-clear action and sorts by priority', () => {
    const input: FocusActionsInput = {
      ...emptyInput,
      cards: [card({ card_type: 'banka_karti' })],
      salaryHistory: [{ ...base, title: 'Maaş', amount: 1, effective_date: '2026-01-01', note: null }],
      accountReconciliations: [{ ...base, card_id: 'id', reconciled_at: new Date().toISOString(), target: 'balance' as const, app_amount: 0, real_amount: 0, drift: 0, note: null }],
    }
    const actions = buildFocusActions(input, cashFlow(), 0, [])
    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe('all-clear')
  })

  it('surfaces an overdue-payments action', () => {
    const input: FocusActionsInput = {
      ...emptyInput,
      cards: [card({ card_type: 'banka_karti' })],
      payments: [{ ...base, title: 'Kira', category: 'Fatura', amount: 1000, amount_status: 'exact', due_date: '2026-06-01', status: 'bekliyor', payment_method: 'manual', recurrence: 'none', recurrence_day: null, recurrence_end_date: null, auto_source_card_id: null, note: null }],
    }
    const actions = buildFocusActions(input, cashFlow(), 0, [])
    expect(actions.some((a) => a.id === 'overdue-payments')).toBe(true)
  })

  it('counts shared card debt breakdown issues in the data health action', () => {
    const input: FocusActionsInput = {
      ...emptyInput,
      cards: [
        card({ id: 'bank-1', card_type: 'banka_karti' }),
        card({
          id: 'credit-1',
          card_type: 'kredi_karti',
          debt_amount: 250,
          statement_debt_amount: 200,
          current_period_spending: 50,
        }),
      ],
      cardInstallments: [cardInstallment({ amount: 100 })],
    }

    const actions = buildFocusActions(input, cashFlow(), 0, [])
    expect(actions.find((action) => action.id === 'data-health')?.description).toContain('1 kayıt')
  })
})
