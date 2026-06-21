import { describe, expect, it } from 'vitest'
import type { Card, CardInstallment } from '../types/database'
import type { DashboardUpcomingItem } from './dashboardUpcoming'
import { buildFocusActions, buildSmartInsights, type FocusActionsInput } from './dashboardInsights'
import type { CashFlowSummary } from './financeSummary'

const cashFlow = (over: Partial<CashFlowSummary> = {}): CashFlowSummary =>
  ({ monthLabel: 'Haziran 2026', projectedCash: 10_000, netFlow: 2_000, ...over }) as CashFlowSummary

function upcoming(daysFromNow: number): DashboardUpcomingItem {
  return {
    id: `u-${daysFromNow}`,
    title: 'Yükümlülük',
    subtitle: '',
    value: '',
    amount: 100,
    cashImpactAmount: 100,
    settlement: 'cash',
    kind: 'payment',
    direction: 'outflow',
    date: '',
    sortTime: Date.now() + daysFromNow * 86_400_000,
  }
}

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01', updated_at: '2026-06-01' }
function card(over: Partial<Card> & Pick<Card, 'card_type'>): Card {
  return {
    ...base,
    bank_name: 'B',
    card_name: 'K',
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

describe('buildSmartInsights', () => {
  it('flags a projected cash gap and caps at 4 insights', () => {
    const insights = buildSmartInsights(cashFlow({ projectedCash: -5_000 }), 90, 10_000, 5_000, [upcoming(2), upcoming(3)])
    expect(insights[0].tone).toBe('rose')
    expect(insights[0].title).toContain('nakit açığı')
    expect(insights.length).toBeLessThanOrEqual(4)
  })

  it('is calm when cash flow is positive and usage low', () => {
    const insights = buildSmartInsights(cashFlow(), 10, 0, 0, [])
    expect(insights).toHaveLength(1)
    expect(insights[0].tone).toBe('emerald')
  })
})

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
