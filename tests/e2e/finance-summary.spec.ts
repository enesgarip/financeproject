import { expect, test } from '@playwright/test'
import type {
  Asset,
  Card,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
} from '../../src/types/database'
import {
  buildCreditLimitGroups,
  buildFinancialPosition,
  buildGoalProgressSummary,
  buildMonthlyCashFlow,
  cardPayableDebt,
  totalCreditLimit,
  type FinanceSummaryInput,
} from '../../src/utils/financeSummary'
import { buildDashboardMonthlyLoad } from '../../src/utils/dashboardUpcoming'

const user_id = 'user-1'
const now = '2026-06-02T12:00:00.000Z'

function base(id: string) {
  return { id, user_id, created_at: now, updated_at: now }
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    name: 'Varlik',
    category: 'Nakit',
    amount: 0,
    unit: 'TRY',
    currency: 'TRY',
    symbol: null,
    unit_cost: null,
    estimated_value_try: 0,
    auto_valued: false,
    source: null,
    note: null,
    ...overrides,
  }
}

function card(overrides: Partial<Card>): Card {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    bank_name: 'Garanti',
    card_name: 'Bonus',
    card_type: 'kredi_karti',
    holder_name: null, account_number: null,
    limit_group_name: null,
    current_balance: 0,
    credit_limit: 100_000,
    debt_amount: 0,
    statement_debt_amount: 0,
    current_period_spending: 0,
    provision_amount: 0,
    statement_day: 10,
    due_day: 20,
    note: null,
    ...overrides,
  }
}

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    card_id: 'card-1',
    card_expense_id: 'expense-1',
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 6,
    due_month: '2026-06-01',
    amount: 5_000,
    description: 'Telefon',
    category: 'Elektronik',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function cardStatement(overrides: Partial<CardStatementArchive>): CardStatementArchive {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    card_id: 'card-1',
    period_year: 2026,
    period_month: 7,
    statement_date: '2026-07-01',
    due_date: '2026-07-20',
    statement_debt_amount: 0,
    current_period_spending: 0,
    total_debt_amount: 0,
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

function loan(overrides: Partial<Loan>): Loan {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    bank_name: 'Banka',
    loan_name: 'Kredi',
    total_amount: 0,
    remaining_amount: 0,
    monthly_payment: 0,
    installment_day: 15,
    start_date: null,
    end_date: null,
    remaining_installments: 0,
    status: 'active',
    note: null,
    ...overrides,
  }
}

function loanInstallment(overrides: Partial<LoanInstallment>): LoanInstallment {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    loan_id: 'loan-1',
    installment_no: 1,
    due_date: '2026-06-15',
    amount: 0,
    status: 'bekliyor',
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    person_name: 'Kisi',
    direction: 'borç_aldım',
    value_type: 'TRY',
    currency: 'TRY',
    amount: 1,
    estimated_value_try: 0,
    auto_valued: false,
    due_date: null,
    status: 'açık',
    note: null,
    ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    title: 'Fatura',
    category: 'Fatura',
    amount: 0,
    amount_status: 'exact',
    due_date: '2026-06-20',
    status: 'bekliyor',
    payment_method: 'manual',
    recurrence: 'none',
    recurrence_day: null,
    recurrence_end_date: null,
    note: null,
    ...overrides,
  }
}

function salary(overrides: Partial<SalaryHistory>): SalaryHistory {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    title: 'Maaş',
    amount: 0,
    effective_date: '2026-01-01',
    note: null,
    ...overrides,
  }
}

function savingsGoal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    name: 'Hedef',
    value_type: 'TRY',
    target_amount: 0,
    current_amount: 0,
    estimated_value_try: null,
    auto_valued: false,
    target_date: null,
    status: 'active',
    note: null,
    ...overrides,
  }
}

function savingsGoalComponent(overrides: Partial<SavingsGoalComponent>): SavingsGoalComponent {
  return {
    ...base(overrides.id ?? crypto.randomUUID()),
    goal_id: 'goal-1',
    label: null,
    value_type: 'TRY',
    target_amount: 0,
    current_amount: 0,
    sort_order: 1,
    ...overrides,
  }
}

function data(overrides: Partial<FinanceSummaryInput>): FinanceSummaryInput {
  return {
    assets: [],
    cards: [],
    loans: [],
    loanInstallments: [],
    debts: [],
    payments: [],
    salaryHistory: [] as SalaryHistory[],
    cardInstallments: [],
    cardStatements: [],
    savingsGoals: [],
    savingsGoalComponents: [],
    ...overrides,
  }
}

test('net worth excludes receivables and includes pending payments as liabilities', () => {
  const summary = buildFinancialPosition(data({
    assets: [asset({ estimated_value_try: 10_000 })],
    debts: [
      debt({ direction: 'borç_aldım', estimated_value_try: 2_000 }),
      debt({ direction: 'borç_verdim', estimated_value_try: 3_000 }),
    ],
    payments: [payment({ amount: 500 })],
  }))

  expect(summary.totalAssets).toBe(10_000)
  expect(summary.totalDebts).toBe(2_500)
  expect(summary.totalReceivables).toBe(3_000)
  expect(summary.netWorth).toBe(7_500)
  expect(summary.netWorthIfReceivablesCollected).toBe(10_500)
})

test('credit card installments are not added as a second debt bucket', () => {
  const summary = buildFinancialPosition(data({
    cards: [
      card({
        id: 'card-1',
        debt_amount: 30_000,
        statement_debt_amount: 5_000,
        current_period_spending: 0,
      }),
    ],
    cardInstallments: [
      cardInstallment({ installment_no: 1, status: 'paid', statement_archive_id: 'statement-1', paid_at: now }),
      cardInstallment({ installment_no: 2, due_month: '2026-07-01', amount: 5_000 }),
      cardInstallment({ installment_no: 3, due_month: '2026-08-01', amount: 5_000 }),
      cardInstallment({ installment_no: 4, due_month: '2026-09-01', amount: 5_000 }),
      cardInstallment({ installment_no: 5, due_month: '2026-10-01', amount: 5_000 }),
      cardInstallment({ installment_no: 6, due_month: '2026-11-01', amount: 5_000 }),
    ],
  }))

  expect(summary.totalCreditCardDebt).toBe(30_000)
  expect(summary.totalDebts).toBe(30_000)
  expect(summary.totalCardFutureInstallmentDebt).toBe(25_000)
})

test('card payable debt excludes future installments and provisions', () => {
  const bonus = card({
    debt_amount: 30_000,
    statement_debt_amount: 5_000,
    current_period_spending: 1_000,
    provision_amount: 2_000,
  })

  expect(cardPayableDebt(bonus)).toBe(6_000)
})

test('next month load separates open statements from card installment planning', () => {
  const loanId = 'loan-1'
  const input = data({
    cards: [card({ id: 'card-1', statement_debt_amount: 9_999, debt_amount: 30_000, due_day: 20 })],
    cardStatements: [cardStatement({ card_id: 'card-1', statement_debt_amount: 5_000, due_date: '2026-07-20' })],
    cardInstallments: [cardInstallment({ card_id: 'card-1', due_month: '2026-07-01', amount: 5_000 })],
    loanInstallments: [loanInstallment({ loan_id: loanId, due_date: '2026-07-15', amount: 2_500 })],
    loans: [loan({ id: loanId, remaining_amount: 10_000, monthly_payment: 2_500, remaining_installments: 4 })],
    payments: [payment({ due_date: '2026-07-05', amount: 750 })],
    debts: [debt({ due_date: '2026-07-12', estimated_value_try: 1_250 })],
  })
  const load = buildDashboardMonthlyLoad(
    {
      cards: input.cards,
      payments: input.payments,
      loans: input.loans,
      loanInstallments: input.loanInstallments,
      debts: input.debts,
      cardInstallments: input.cardInstallments,
      cardStatements: input.cardStatements ?? [],
    },
    new Date('2026-07-01T00:00:00'),
    new Date('2026-06-01T00:00:00'),
  )

  expect(load.cardStatements).toBe(5_000)
  expect(load.cardInstallments).toBe(5_000)
  expect(load.loanInstallments).toBe(2_500)
  expect(load.legacyLoanInstallments).toBe(0)
  expect(load.payments).toBe(750)
  expect(load.personalDebts).toBe(1_250)
  expect(load.total).toBe(
    load.cardStatements +
      load.cardInstallments +
      load.loanInstallments +
      load.legacyLoanInstallments +
      load.payments +
      load.personalDebts,
  )
  expect(load.total).toBe(14_500)
})

test('shared credit limits are counted once per group', () => {
  const cards = [
    card({ id: 'card-1', card_name: 'Asil', limit_group_name: 'Aile', credit_limit: 60_000, debt_amount: 10_000 }),
    card({ id: 'card-2', card_name: 'Ek', limit_group_name: 'Aile', credit_limit: 60_000, debt_amount: 5_000 }),
    card({ id: 'card-3', card_name: 'Tekil', limit_group_name: null, credit_limit: 20_000, debt_amount: 2_000 }),
  ]

  expect(totalCreditLimit(cards)).toBe(80_000)

  const groups = buildCreditLimitGroups(cards)
  expect(groups).toHaveLength(2)
  expect(groups.find((group) => group.label === 'Aile')?.limit).toBe(60_000)
  expect(groups.find((group) => group.label === 'Aile')?.debt).toBe(15_000)
})

test('monthly cash flow counts one-off and active recurring payments once', () => {
  const flow = buildMonthlyCashFlow(
    data({
      salaryHistory: [salary({ amount: 10_000 })],
      payments: [
        payment({ id: 'payment-1', amount: 500, recurrence: 'monthly', recurrence_day: 5, due_date: '2026-01-05' }),
        payment({ id: 'payment-2', amount: 700, due_date: '2026-07-12' }),
        payment({ id: 'payment-3', amount: 900, recurrence: 'monthly', recurrence_day: 8, due_date: '2026-01-08', recurrence_end_date: '2026-06-30' }),
        payment({ id: 'payment-4', amount: 300, status: 'ödendi', due_date: '2026-07-20' }),
      ],
    }),
    new Date('2026-07-01T00:00:00'),
  )

  expect(flow.income).toBe(10_000)
  expect(flow.paymentOutflow).toBe(1_200)
  expect(flow.outflow).toBe(1_200)
  expect(flow.netFlow).toBe(8_800)
})

test('goal progress caps individual goals and averages composite components', () => {
  const tryGoal = savingsGoal({ id: 'goal-try', target_amount: 1_000, current_amount: 1_500 })
  const compositeGoal = savingsGoal({ id: 'goal-composite', value_type: 'composite', target_amount: 2, current_amount: 0 })
  const summary = buildGoalProgressSummary(
    [tryGoal, compositeGoal],
    [
      savingsGoalComponent({ goal_id: 'goal-composite', target_amount: 10, current_amount: 5, sort_order: 1 }),
      savingsGoalComponent({ goal_id: 'goal-composite', target_amount: 20, current_amount: 20, sort_order: 2 }),
    ],
  )

  expect(summary.activeCount).toBe(2)
  expect(summary.averageProgress).toBe(87.5)
})
