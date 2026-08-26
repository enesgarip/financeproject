import { expect, test } from '@playwright/test'
import type {
  Asset,
  Card,
  CardInstallment,
  Debt,
  Payment,
  SalaryHistory,
} from '../../src/types/database'
import {
  buildCreditLimitGroups,
  buildFinancialPosition,
  buildMonthlyCashFlow,
  cardPayableDebt,
  totalCreditLimit,
  type FinanceSummaryInput,
} from '../../src/utils/financeSummary'

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
    valued_at: null,
    valuation_rate: null,
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
    valued_at: null,
    valuation_rate: null,
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
    auto_source_card_id: null,
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
