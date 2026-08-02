import { describe, expect, it } from 'vitest'
import type {
  AccountLedger,
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
  CardLedger,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
} from '../types/database'
import { dateInputValue } from '../utils/date'
import { buildIssues } from './DataHealth.logic'
import { emptyData } from './DataHealth.actions'

const base = {
  id: 'asset-1',
  user_id: 'user-1',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    ...base,
    name: 'Varlık',
    category: 'Nakit',
    amount: 1,
    unit: 'TRY',
    currency: 'TRY',
    symbol: null,
    unit_cost: null,
    estimated_value_try: 1000,
    auto_valued: false,
    source: null,
    note: null,
    ...overrides,
  }
}

describe('buildIssues asset health checks', () => {
  it('does not normalize stock share quantity as a stale technical asset amount', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'stock-1',
          name: 'THYAO',
          category: 'Hisse',
          amount: 42,
          unit: 'TRY',
          currency: null,
          symbol: 'THYAO',
          unit_cost: 250,
          auto_valued: true,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-stock-1')).toBeUndefined()
  })

  it('still normalizes non-stock non-gold technical amount fields', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'fund-1',
          name: 'Fon',
          category: 'Fon',
          amount: 42,
          unit: 'adet',
          currency: null,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-fund-1')?.payload?.updates).toEqual({
      amount: 1,
      unit: 'TRY',
    })
  })

  it('fixes only the technical unit for stocks and keeps the share count intact', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'stock-unit-1',
          name: 'GARAN',
          category: 'Hisse',
          amount: 35,
          unit: 'adet',
          currency: null,
          symbol: 'GARAN',
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-stock-unit-1')?.payload?.updates).toEqual({
      unit: 'TRY',
    })
  })

  it('preserves foreign-currency cash quantity and unit as valuation source data', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [
        asset({
          id: 'fx-cash-1',
          name: 'Dolar',
          category: 'Nakit',
          currency: 'USD',
          amount: 1250,
          unit: 'adet',
          auto_valued: true,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-fx-cash-1')).toBeUndefined()
  })

  it('still normalizes TRY cash technical quantity and unit fields', () => {
    const issues = buildIssues({
      ...emptyData,
      assets: [asset({ id: 'try-cash-1', currency: 'TRY', amount: 1250, unit: 'adet' })],
    })

    expect(issues.find((issue) => issue.id === 'asset-shape-try-cash-1')?.payload?.updates).toEqual({
      amount: 1,
      unit: 'TRY',
    })
  })
})

function debt(overrides: Partial<Debt> = {}): Debt {
  return {
    ...base,
    id: 'debt-1',
    person_name: 'Kişi',
    direction: 'borç_aldım',
    value_type: 'TRY',
    currency: 'TRY',
    amount: 1,
    estimated_value_try: 1000,
    auto_valued: false,
    due_date: null,
    status: 'açık',
    note: null,
    ...overrides,
  }
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    ...base,
    id: 'budget-1',
    month: '2999-08-15',
    category: 'Market',
    limit_amount: 1000,
    note: null,
    ...overrides,
  }
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    ...base,
    id: 'payment-1',
    title: 'Ödeme',
    category: 'Fatura',
    amount: 100,
    amount_status: 'exact',
    due_date: '2999-08-15',
    status: 'bekliyor',
    payment_method: 'manual',
    recurrence: 'monthly',
    recurrence_day: 10,
    recurrence_end_date: null,
    auto_source_card_id: null,
    note: null,
    ...overrides,
  }
}

describe('buildIssues debt source quantities', () => {
  it('preserves foreign-currency debt amount as auto-valuation source data', () => {
    const issues = buildIssues({
      ...emptyData,
      debts: [
        debt({
          value_type: 'doviz',
          currency: 'USD',
          amount: 125,
          estimated_value_try: 5000,
          auto_valued: true,
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'debt-shape-debt-1')).toBeUndefined()
  })

  it('still normalizes the technical amount field for TRY debt', () => {
    const issues = buildIssues({
      ...emptyData,
      debts: [debt({ amount: 125 })],
    })

    expect(issues.find((issue) => issue.id === 'debt-shape-debt-1')?.payload?.updates).toEqual({
      amount: 1,
    })
  })
})

function creditCard(overrides: Partial<Card> = {}): Card {
  return {
    ...base,
    id: 'card-1',
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'kredi_karti',
    holder_name: null, account_number: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 10000,
    debt_amount: 120,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: 1,
    due_day: 10,
    note: null,
    ...overrides,
  }
}

function cardInstallment(overrides: Partial<CardInstallment> = {}): CardInstallment {
  return {
    ...base,
    id: 'installment-1',
    card_id: 'card-1',
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
    ...overrides,
  }
}

function cardExpense(overrides: Partial<CardExpense> = {}): CardExpense {
  return {
    ...base,
    id: 'expense-1',
    card_id: 'card-1',
    statement_archive_id: null,
    spent_at: '2026-06-15',
    amount: 520,
    description: 'Migros',
    category: 'Market',
    installment_count: 1,
    installment_amount: 520,
    status: 'posted',
    posted_at: '2026-06-15T12:00:00.000Z',
    note: null,
    ...overrides,
    transaction_fingerprint: overrides.transaction_fingerprint ?? null,
    source: overrides.source ?? null,
  }
}

function cardStatementArchive(overrides: Partial<CardStatementArchive> = {}): CardStatementArchive {
  return {
    ...base,
    id: 'statement-1',
    card_id: 'card-1',
    period_year: 2026,
    period_month: 1,
    statement_date: '2026-01-01',
    due_date: '2026-01-10',
    statement_debt_amount: 1200,
    current_period_spending: 0,
    total_debt_amount: 1200,
    status: 'open',
    paid_at: null,
    payment_source_card_id: null,
    reconciled_bank_amount: null,
    reconciled_at: null,
    reconciliation_note: null,
    note: null,
    ...overrides,
  }
}

describe('buildIssues card debt breakdown', () => {
  it('flags scheduled installments missing from card debt', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [
        creditCard({
          debt_amount: 250,
          statement_debt_amount: 200,
          current_period_spending: 50,
        }),
      ],
      cardInstallments: [
        cardInstallment({ id: 'installment-1', amount: 0.1 }),
        cardInstallment({ id: 'installment-2', amount: 0.2 }),
      ],
    })

    const issue = issues.find((item) => item.id === 'card-scheduled-debt-card-1')
    expect(issue?.kind).toBe('cardScheduledDebt')
    expect(issue?.fixable).toBe(false)
    expect(issue?.payload).toMatchObject({
      cardId: 'card-1',
      scheduledTotal: 0.3,
    })
    expect(issue?.payload?.nextDebtAmount).toBeUndefined()
  })

  it('flags installment overflow without guessing a new card debt', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 100 })],
      cardInstallments: [cardInstallment({ amount: 120 })],
    })

    const issue = issues.find((item) => item.id === 'card-installment-overflow-card-1')
    expect(issue).toMatchObject({
      kind: 'cardInstallmentOverflow',
      fixable: false,
      payload: { cardId: 'card-1', scheduledTotal: 120, amount: 20 },
    })
    expect(issue?.payload?.nextDebtAmount).toBeUndefined()
  })

  it('does not flag planned installment debt as unclassified', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [
        creditCard({
          debt_amount: 450,
          statement_debt_amount: 200,
          current_period_spending: 50,
        }),
      ],
      cardInstallments: [cardInstallment({ amount: 200 })],
    })

    expect(issues.find((item) => item.id === 'card-unclassified-debt-card-1')).toBeUndefined()
  })

  it('flags only debt beyond scheduled installments as unclassified', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [
        creditCard({
          debt_amount: 500,
          statement_debt_amount: 100,
          current_period_spending: 100,
          provision_amount: 50,
        }),
      ],
      cardInstallments: [cardInstallment({ amount: 200 })],
    })

    const issue = issues.find((item) => item.id === 'card-unclassified-debt-card-1')
    expect(issue?.kind).toBe('cardDebtSplit')
    expect(issue?.severity).toBe('warning')
    expect(issue?.fixable).toBe(false)
    expect(issue?.fixLabel).toBeUndefined()
    expect(issue?.payload).toMatchObject({
      cardId: 'card-1',
      statementDebt: 150,
      currentPeriod: 100,
      provisionAmount: 50,
    })
  })

  it('flags a partial scheduled-debt overlap without offering an automatic fix', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [
        creditCard({
          debt_amount: 83_316.62,
          statement_debt_amount: 20_168.53,
          current_period_spending: 0,
        }),
      ],
      cardInstallments: [cardInstallment({ amount: 63_446.29 })],
    })

    const issue = issues.find((item) => item.id === 'card-scheduled-debt-overlap-card-1')
    expect(issue).toMatchObject({
      kind: 'cardScheduledDebtOverlap',
      severity: 'warning',
      fixable: false,
      payload: {
        cardId: 'card-1',
        scheduledTotal: 63_446.29,
        amount: 298.2,
      },
    })
    expect(issues.find((item) => item.id === 'card-scheduled-debt-card-1')).toBeUndefined()
  })

  it('does not double-report scheduled overlap when the visible split itself overflows debt', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [
        creditCard({
          debt_amount: 100,
          statement_debt_amount: 80,
          current_period_spending: 30,
        }),
      ],
      cardInstallments: [cardInstallment({ amount: 20 })],
    })

    expect(issues.find((item) => item.id === 'card-split-card-1')).toBeDefined()
    expect(issues.find((item) => item.id === 'card-scheduled-debt-card-1')).toBeUndefined()
    expect(issues.find((item) => item.id === 'card-scheduled-debt-overlap-card-1')).toBeUndefined()
  })
})

describe('buildIssues card installment dates', () => {
  it('does not rewrite a historical posted date even when it has the legacy month-start shape', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 300, current_period_spending: 100 })],
      cardExpenses: [
        cardExpense({
          amount: 300,
          installment_count: 3,
          installment_amount: 100,
          spent_at: '2026-05-19',
        }),
      ],
      cardInstallments: [
        cardInstallment({
          card_expense_id: 'expense-1',
          installment_no: 2,
          installment_count: 3,
          amount: 100,
          due_month: '2026-06-01',
          status: 'posted',
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'card-installment-date-installment-1')).toMatchObject({
      kind: 'manual',
      fixable: false,
    })
  })

  it('offers a guarded rewrite only for a future scheduled legacy month-start date', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 300 })],
      cardExpenses: [
        cardExpense({
          amount: 300,
          installment_count: 3,
          installment_amount: 100,
          spent_at: '2999-05-19',
        }),
      ],
      cardInstallments: [
        cardInstallment({
          card_expense_id: 'expense-1',
          installment_no: 2,
          installment_count: 3,
          amount: 100,
          due_month: '2999-06-01',
          status: 'scheduled',
        }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'card-installment-date-installment-1')).toMatchObject({
      kind: 'cardInstallmentDueMonth',
      fixable: false,
      payload: {
        updates: { due_month: '2999-06-19' },
        expectedUpdatedAt: '2026-06-01T00:00:00.000Z',
      },
    })
  })

  it('does not offer a date rewrite for an installment locked by an early settlement', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 100 })],
      cardExpenses: [
        cardExpense({
          amount: 300,
          installment_count: 3,
          installment_amount: 100,
          spent_at: '2026-05-19',
        }),
      ],
      cardInstallments: [
        cardInstallment({
          card_expense_id: 'expense-1',
          current_settlement_id: 'settlement-1',
          installment_no: 2,
          installment_count: 3,
          amount: 100,
          due_month: '2026-06-01',
          status: 'paid',
        }),
      ],
    })

    expect(issues.some((issue) => issue.id === 'card-installment-date-installment-1')).toBe(false)
  })
})

describe('buildIssues card installment lifecycle repair safety', () => {
  it('keeps a missing posted_at manual instead of inventing the current time', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardInstallments: [
        cardInstallment({
          installment_count: 2,
          amount: 100,
          status: 'posted',
          posted_at: null,
        }),
      ],
    })

    const issue = issues.find((item) => item.id === 'card-installment-posted-at-installment-1')
    expect(issue).toMatchObject({
      kind: 'cardInstallmentPostedAt',
      fixable: false,
      payload: { ids: ['installment-1'] },
    })
    expect(issue?.payload?.updates).toBeUndefined()
  })

  it('keeps clearing an impossible posted_at in the guided owner flow', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardInstallments: [
        cardInstallment({
          installment_count: 2,
          amount: 100,
          status: 'scheduled',
          due_month: '2999-06-01',
          posted_at: '2026-06-01T12:00:00.000Z',
        }),
      ],
    })

    expect(issues.find((item) => item.id === 'card-installment-clear-posted-at-installment-1')).toMatchObject({
      kind: 'cardInstallmentPostedAt',
      fixable: false,
      payload: { ids: ['installment-1'], updates: { posted_at: null } },
    })
  })

  it('offers missing-installment repair only when every missing row is in the future', () => {
    const futureIssues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 300 })],
      cardExpenses: [
        cardExpense({
          amount: 300,
          installment_count: 3,
          installment_amount: 100,
          spent_at: '2999-01-15',
        }),
      ],
    })

    expect(futureIssues.find((item) => item.id === 'card-expense-missing-expense-1')).toMatchObject({
      kind: 'cardMissingInstallments',
      fixable: false,
      payload: { installmentNos: [1, 2, 3], baseDate: '2999-01-15' },
    })

    const todayIssues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 200 })],
      cardExpenses: [
        cardExpense({
          amount: 200,
          installment_count: 2,
          installment_amount: 100,
          spent_at: dateInputValue(new Date()),
        }),
      ],
    })

    const todayIssue = todayIssues.find((item) => item.id === 'card-expense-missing-expense-1')
    expect(todayIssue).toMatchObject({ fixable: false, kind: 'manual' })
    expect(todayIssue?.payload).toBeUndefined()
  })

  it('protects an entire plan from structural fixes when a sibling has current-settlement evidence', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 300 })],
      cardExpenses: [
        cardExpense({
          amount: 300,
          installment_count: 3,
          installment_amount: 90,
          spent_at: '2999-01-15',
        }),
      ],
      cardInstallments: [
        cardInstallment({
          id: 'settled-child',
          card_expense_id: 'expense-1',
          current_settlement_id: 'settlement-1',
          installment_no: 1,
          installment_count: 3,
          amount: 100,
          due_month: '2999-01-15',
          status: 'paid',
          paid_at: '2999-01-15',
        }),
        cardInstallment({
          id: 'current-sibling',
          card_expense_id: 'expense-1',
          installment_no: 2,
          installment_count: 2,
          amount: 100,
          due_month: '2999-02-01',
          status: 'scheduled',
          posted_at: '2999-02-01T00:00:00.000Z',
        }),
      ],
    })

    const protectedIssueIds = [
      'card-expense-amount-expense-1',
      'card-installment-clear-posted-at-current-sibling',
      'card-installment-count-current-sibling',
      'card-installment-date-current-sibling',
      'card-expense-missing-expense-1',
    ]

    for (const id of protectedIssueIds) {
      expect(issues.find((issue) => issue.id === id)).toMatchObject({
        fixable: false,
        kind: 'manual',
      })
      expect(issues.find((issue) => issue.id === id)?.payload).toBeUndefined()
    }
  })
})

describe('buildIssues archived installment structure safety', () => {
  it('keeps every archive-linked structural repair manual, including siblings and missing rows', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 400, statement_debt_amount: 200 })],
      cardExpenses: [
        cardExpense({
          id: 'archived-single',
          amount: 100,
          installment_count: 1,
          installment_amount: 90,
          statement_archive_id: 'statement-1',
        }),
        cardExpense({
          id: 'archived-plan',
          amount: 300,
          installment_count: 3,
          installment_amount: 90,
          spent_at: '2026-05-19',
        }),
      ],
      cardInstallments: [
        cardInstallment({
          id: 'single-child',
          card_expense_id: 'archived-single',
          statement_archive_id: 'statement-1',
          amount: 100,
        }),
        cardInstallment({
          id: 'archived-child',
          card_expense_id: 'archived-plan',
          statement_archive_id: 'statement-1',
          installment_no: 1,
          installment_count: 2,
          amount: 100,
          due_month: '2026-06-01',
          status: 'posted',
          posted_at: null,
        }),
        cardInstallment({
          id: 'archive-sibling',
          card_expense_id: 'archived-plan',
          installment_no: 2,
          installment_count: 3,
          amount: 100,
          due_month: '2026-07-01',
          status: 'scheduled',
          posted_at: '2026-07-01T00:00:00.000Z',
        }),
      ],
    })

    const protectedIssueIds = [
      'card-expense-amount-archived-single',
      'card-expense-amount-archived-plan',
      'card-installment-posted-at-archived-child',
      'card-installment-count-archived-child',
      'card-installment-date-archived-child',
      'card-installment-clear-posted-at-archive-sibling',
      'card-installment-date-archive-sibling',
      'card-expense-missing-archived-plan',
    ]

    for (const id of protectedIssueIds) {
      expect(issues.find((issue) => issue.id === id)).toMatchObject({
        fixable: false,
        kind: 'manual',
      })
      expect(issues.find((issue) => issue.id === id)?.payload).toBeUndefined()
    }

    expect(issues.find((issue) => issue.id === 'card-expense-single-has-installments-archived-single')).toMatchObject({
      fixable: false,
      kind: 'cardSingleInstallments',
    })
  })
})

describe('buildIssues carryover installment history (DH-01)', () => {
  it('does not flag carryover past installment rows as extra', () => {
    // record_card_installment_carryover 1/3 ve 2/3'ü `posted` geçmiş satırı olarak
    // KASITLI yaratır (note: "2/3 taksiti uygulama öncesinde ödendi."). Bunlar "fazla" sayılmamalı.
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 100 })],
      cardExpenses: [
        cardExpense({
          amount: 300,
          installment_count: 3,
          installment_amount: 100,
          spent_at: '2026-05-19',
          note: '2/3 taksiti uygulama öncesinde ödendi.',
        }),
      ],
      cardInstallments: [
        cardInstallment({ id: 'i1', card_expense_id: 'expense-1', installment_no: 1, installment_count: 3, amount: 100, due_month: '2026-05-19', status: 'posted' }),
        cardInstallment({ id: 'i2', card_expense_id: 'expense-1', installment_no: 2, installment_count: 3, amount: 100, due_month: '2026-06-19', status: 'posted' }),
        cardInstallment({ id: 'i3', card_expense_id: 'expense-1', installment_no: 3, installment_count: 3, amount: 100, due_month: '2026-07-19', status: 'scheduled' }),
      ],
    })

    expect(issues.some((issue) => issue.id === 'card-expense-extra-expense-1')).toBe(false)
  })

  it('still flags a genuinely out-of-range installment number', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 100 })],
      cardExpenses: [
        cardExpense({ amount: 300, installment_count: 3, installment_amount: 100, spent_at: '2026-05-19' }),
      ],
      cardInstallments: [
        cardInstallment({ id: 'i4', card_expense_id: 'expense-1', installment_no: 4, installment_count: 3, amount: 100, due_month: '2026-08-19', status: 'scheduled' }),
      ],
    })

    expect(issues.some((issue) => issue.id === 'card-expense-extra-expense-1')).toBe(true)
  })
})

describe('buildIssues overdue card statements', () => {
  it('flags an open statement whose due date has passed', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardStatementArchives: [cardStatementArchive()],
    })

    const issue = issues.find((item) => item.id === 'card-overdue-statement-statement-1')
    expect(issue?.kind).toBe('cardOverduePayment')
    expect(issue?.payload).toMatchObject({
      cardId: 'card-1',
      statementArchiveId: 'statement-1',
      amount: 1200,
    })
  })

  it('flags legacy inactive statement status for manual reconciliation', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardStatementArchives: [
        cardStatementArchive({
          status: 'inactive' as CardStatementArchive['status'],
        }),
      ],
    })

    const issue = issues.find((item) => item.id === 'card-archive-status-statement-1')
    expect(issue?.kind).toBe('cardStatementStatus')
    expect(issue?.fixable).toBe(false)
    expect(issue?.payload).toMatchObject({
      cardId: 'card-1',
      statementArchiveId: 'statement-1',
    })
    expect(issue?.payload?.updates).toBeUndefined()
  })
})

describe('buildIssues orphan statement debt', () => {
  it('flags statement_debt > 0 when no open archive exists', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({
        debt_amount: 500,
        statement_debt_amount: 200,
        current_period_spending: 300,
      })],
      cardStatementArchives: [cardStatementArchive({ status: 'paid' })],
    })

    const issue = issues.find((item) => item.id === 'card-orphan-statement-debt-card-1')
    expect(issue?.kind).toBe('cardDebtSplit')
    expect(issue?.fixable).toBe(false)
    expect(issue?.fixLabel).toBeUndefined()
    expect(issue?.payload).toMatchObject({
      cardId: 'card-1',
      statementDebt: 0,
      currentPeriod: 500,
    })
  })

  it('does not flag when an open archive exists', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({
        debt_amount: 500,
        statement_debt_amount: 200,
        current_period_spending: 300,
      })],
      cardStatementArchives: [cardStatementArchive({ status: 'open' })],
    })

    expect(issues.find((item) => item.id === 'card-orphan-statement-debt-card-1')).toBeUndefined()
  })

  it('does not flag when statement_debt is 0', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({
        debt_amount: 300,
        statement_debt_amount: 0,
        current_period_spending: 300,
      })],
      cardStatementArchives: [],
    })

    expect(issues.find((item) => item.id === 'card-orphan-statement-debt-card-1')).toBeUndefined()
  })
})

describe('buildIssues card expense duplicate analysis', () => {
  it('flags exact duplicate card expenses', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardExpenses: [
        cardExpense({ id: 'expense-1', description: 'Migros Sanal POS' }),
        cardExpense({ id: 'expense-2', description: 'Migros Sanal POS' }),
      ],
    })

    const duplicate = issues.find((issue) => issue.kind === 'duplicateTransactionCandidate')
    expect(duplicate?.payload?.duplicateLevel).toBe('same_fingerprint')
    expect(duplicate?.payload?.ids).toEqual(['expense-1', 'expense-2'])
    expect(duplicate?.title).not.toContain('kesin')
    expect(duplicate?.details).not.toContain('Güven: %98')
    expect(duplicate?.description).toContain('tekrar kanıtı değildir')
  })

  it('flags possible duplicates with the same day and amount but similar descriptions', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardExpenses: [
        cardExpense({ id: 'expense-1', description: 'Migros Sanal POS' }),
        cardExpense({ id: 'expense-2', description: 'Migros' }),
      ],
    })

    const duplicate = issues.find((issue) => issue.kind === 'duplicateTransactionCandidate')
    expect(duplicate?.payload?.duplicateLevel).toBe('possible')
    expect(duplicate?.severity).toBe('info')
  })

  it('reports card expenses without description or category', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard()],
      cardExpenses: [
        cardExpense({ id: 'expense-1', description: '', category: '' }),
      ],
    })

    expect(issues.find((issue) => issue.id === 'card-expense-missing-description')?.payload?.ids).toEqual(['expense-1'])
    expect(issues.find((issue) => issue.id === 'card-expense-missing-category')?.payload?.ids).toEqual(['expense-1'])
  })
})

function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    ...base,
    id: 'loan-1',
    bank_name: 'Banka',
    loan_name: 'Kredi',
    total_amount: 100,
    remaining_amount: 100,
    monthly_payment: 100,
    installment_day: 10,
    start_date: '2026-01-10',
    end_date: '2026-12-10',
    remaining_installments: 1,
    status: 'active',
    note: null,
    ...overrides,
  }
}

function loanInstallment(overrides: Partial<LoanInstallment> = {}): LoanInstallment {
  return {
    ...base,
    id: 'loan-installment-1',
    loan_id: 'loan-1',
    installment_no: 1,
    due_date: '2026-06-10',
    amount: 100,
    status: 'bekliyor',
    paid_at: null,
    note: null,
    ...overrides,
  }
}

describe('buildIssues loan historical-date repair safety', () => {
  it('does not offer due-date auto-fix for an already paid installment', () => {
    const issues = buildIssues({
      ...emptyData,
      loans: [loan({ remaining_amount: 0, remaining_installments: 0, status: 'closed' })],
      loanInstallments: [
        loanInstallment({
          due_date: '2026-06-12',
          status: 'ödendi',
          paid_at: '2026-06-12T12:00:00.000Z',
        }),
      ],
    })

    expect(issues.find((item) => item.id === 'loan-installment-due-day-loan-installment-1')).toMatchObject({
      kind: 'loanInstallmentDueDay',
      fixable: false,
      payload: { ids: ['loan-installment-1'], updates: { due_date: '2026-06-10' } },
    })
  })

  it('keeps due-date alignment fixable for a pending installment', () => {
    const issues = buildIssues({
      ...emptyData,
      loans: [loan()],
      loanInstallments: [loanInstallment({ due_date: '2026-06-12' })],
    })

    expect(issues.find((item) => item.id === 'loan-installment-due-day-loan-installment-1')).toMatchObject({
      kind: 'loanInstallmentDueDay',
      fixable: true,
      payload: { updates: { due_date: '2026-06-10' } },
    })
  })

  it('keeps a missing paid_at manual instead of inventing a payment time', () => {
    const issues = buildIssues({
      ...emptyData,
      loans: [loan({ remaining_amount: 0, remaining_installments: 0, status: 'closed' })],
      loanInstallments: [loanInstallment({ status: 'ödendi', paid_at: null })],
    })

    expect(issues.find((item) => item.id === 'loan-paid-at-missing')).toMatchObject({
      kind: 'loanPaidAtMissing',
      fixable: false,
      payload: { ids: ['loan-installment-1'] },
    })
  })
})

describe('buildIssues guarded optimistic repair preconditions', () => {
  it('keeps budget month alignment automatic only when the target key is unique', () => {
    const safeIssues = buildIssues({
      ...emptyData,
      budgets: [budget()],
    })
    expect(safeIssues.find((item) => item.id === 'budget-month-budget-1')).toMatchObject({
      kind: 'budgetMonth',
      fixable: true,
      payload: { expectedUpdatedAt: base.updated_at },
    })

    const collisionIssues = buildIssues({
      ...emptyData,
      budgets: [
        budget(),
        budget({ id: 'budget-2', month: '2999-08-01' }),
      ],
    })
    expect(collisionIssues.find((item) => item.id === 'budget-month-budget-1')).toMatchObject({
      kind: 'manual',
      fixable: false,
    })
  })

  it('aligns only future pending monthly payment dates automatically', () => {
    const safeIssues = buildIssues({
      ...emptyData,
      payments: [payment()],
    })
    expect(safeIssues.find((item) => item.id === 'payment-due-day-payment-1')).toMatchObject({
      kind: 'paymentDueDay',
      fixable: true,
      payload: { dueDate: '2999-08-10', expectedUpdatedAt: base.updated_at },
    })

    for (const unsafePayment of [
      payment({ status: 'ödendi' }),
      payment({ due_date: '2020-08-15' }),
    ]) {
      const issues = buildIssues({ ...emptyData, payments: [unsafePayment] })
      expect(issues.find((item) => item.id === 'payment-due-day-payment-1')).toMatchObject({
        kind: 'manual',
        fixable: false,
      })
    }
  })

  it('does not rewrite recurrence metadata on a paid historical payment', () => {
    const issues = buildIssues({
      ...emptyData,
      payments: [
        payment({
          recurrence: 'none',
          recurrence_day: 10,
          recurrence_end_date: '2026-08-10',
          status: 'ödendi',
        }),
      ],
    })

    expect(issues.find((item) => item.id === 'payment-recurrence-fields-payment-1')).toMatchObject({
      kind: 'manual',
      fixable: false,
    })
  })
})

function ledgerEvent(overrides: Partial<CardLedger> = {}): CardLedger {
  return {
    ...base,
    id: 'ledger-1',
    card_id: 'card-1',
    occurred_at: '2026-06-01T00:00:00.000Z',
    kind: 'opening',
    amount_kurus: 10000,
    statement_delta_kurus: null,
    current_delta_kurus: null,
    provision_delta_kurus: null,
    note: null,
    source_table: 'cards',
    source_id: 'card-1',
    ...overrides,
  }
}

describe('buildIssues card ledger drift (A2.1)', () => {
  it('flags a fixable drift when stored debt differs from the ledger projection', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 120 })],
      cardLedger: [ledgerEvent({ amount_kurus: 10000 })], // projection = 100 TL
    })

    const drift = issues.find((issue) => issue.id === 'card-ledger-drift-card-1')
    expect(drift?.kind).toBe('cardLedgerDrift')
    expect(drift?.fixable).toBe(true)
    expect(drift?.payload?.nextDebtAmount).toBe(100)
  })

  it('does not flag when the projection equals the stored debt', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 100 })],
      cardLedger: [ledgerEvent({ amount_kurus: 10000 })],
    })

    expect(issues.find((issue) => issue.id === 'card-ledger-drift-card-1')).toBeUndefined()
  })

  it('does not flag when the card has no ledger events (table not deployed / empty)', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [creditCard({ debt_amount: 120 })],
      cardLedger: [],
    })

    expect(issues.find((issue) => issue.id === 'card-ledger-drift-card-1')).toBeUndefined()
  })
})

function bankCard(overrides: Partial<Card> = {}): Card {
  return creditCard({
    id: 'bank-1',
    card_type: 'banka_karti',
    current_balance: 1200,
    credit_limit: 0,
    debt_amount: 0,
    statement_day: null,
    due_day: null,
    ...overrides,
  })
}

function accountEvent(overrides: Partial<AccountLedger> = {}): AccountLedger {
  return {
    ...base,
    id: 'acct-1',
    card_id: 'bank-1',
    occurred_at: '2026-06-01T00:00:00.000Z',
    kind: 'opening',
    amount_kurus: 100000,
    note: null,
    source_table: 'cards',
    source_id: 'bank-1',
    ...overrides,
  }
}

describe('buildIssues account ledger drift (Faz 3.1)', () => {
  it('flags a fixable drift when stored balance differs from the ledger projection', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [bankCard({ current_balance: 1200 })],
      accountLedger: [accountEvent({ amount_kurus: 100000 })], // projection = 1000 TL
    })

    const drift = issues.find((issue) => issue.id === 'account-ledger-drift-bank-1')
    expect(drift?.kind).toBe('accountLedgerDrift')
    expect(drift?.fixable).toBe(true)
    expect(drift?.payload?.nextDebtAmount).toBe(1000)
  })

  it('does not flag when the projection equals the stored balance', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [bankCard({ current_balance: 1000 })],
      accountLedger: [accountEvent({ amount_kurus: 100000 })],
    })

    expect(issues.find((issue) => issue.id === 'account-ledger-drift-bank-1')).toBeUndefined()
  })

  it('does not flag when the account has no ledger events', () => {
    const issues = buildIssues({
      ...emptyData,
      cards: [bankCard({ current_balance: 1200 })],
      accountLedger: [],
    })

    expect(issues.find((issue) => issue.id === 'account-ledger-drift-bank-1')).toBeUndefined()
  })
})
