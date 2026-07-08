import { describe, expect, it } from 'vitest'
import type { Card, CardInstallment, CardStatementArchive, Debt, Loan, LoanInstallment, Payment } from '../types/database'
import {
  buildFinanceObligationsForMonth,
  buildFinanceObligationsForRange,
  summarizeFinanceObligations,
  type FinanceObligationsInput,
} from './obligations'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const FROM = new Date(2026, 5, 1)

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

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base,
    title: 'Fatura',
    category: 'Fatura',
    amount: 0,
    amount_status: 'exact',
    due_date: '2026-06-01',
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

function loan(overrides: Partial<Loan>): Loan {
  return {
    ...base,
    bank_name: 'Banka',
    loan_name: 'Kredi',
    total_amount: 0,
    remaining_amount: 0,
    monthly_payment: 0,
    installment_day: null,
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
    ...base,
    loan_id: 'loan',
    installment_no: 1,
    due_date: '2026-06-01',
    amount: 0,
    status: 'bekliyor',
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base,
    person_name: 'Kisi',
    direction: 'borç_aldım',
    value_type: 'TRY',
    currency: null,
    amount: 1,
    estimated_value_try: 0,
    auto_valued: false,
    due_date: null,
    status: 'açık',
    note: null,
    ...overrides,
  }
}

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return {
    ...base,
    card_id: 'card',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 3,
    due_month: '2026-06-01',
    amount: 0,
    description: 'Taksit',
    category: 'Diğer',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    ...overrides,
  }
}

function statement(overrides: Partial<CardStatementArchive>): CardStatementArchive {
  return {
    ...base,
    card_id: 'card',
    period_year: 2026,
    period_month: 6,
    statement_date: '2026-06-01',
    due_date: '2026-06-10',
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

function input(overrides: Partial<FinanceObligationsInput> = {}): FinanceObligationsInput {
  return {
    cards: [],
    payments: [],
    loans: [],
    loanInstallments: [],
    debts: [],
    cardInstallments: [],
    cardStatements: [],
    ...overrides,
  }
}

describe('buildFinanceObligationsForMonth', () => {
  it('combines planned outflows and receivables into a monthly summary', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        payments: [payment({ amount: 1000, due_date: '2026-06-15' })],
        loans: [loan({ id: 'loan', loan_name: 'Konut' })],
        loanInstallments: [loanInstallment({ loan_id: 'loan', amount: 3000, due_date: '2026-06-05' })],
        debts: [
          debt({ direction: 'borç_aldım', estimated_value_try: 750, due_date: '2026-06-20' }),
          debt({ id: 'receivable', direction: 'borç_verdim', estimated_value_try: 500, due_date: '2026-06-25' }),
        ],
      }),
      FROM,
      { from: FROM },
    )

    expect(items.map((item) => item.kind)).toEqual(['loan_installment', 'payment', 'personal_debt', 'personal_receivable'])
    expect(summarizeFinanceObligations(items)).toMatchObject({ outflow: 4750, inflow: 500, net: -4250, payableCount: 4 })
  })

  it('uses open statement archives instead of duplicating card statement debt', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'card', card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 3000 })],
        cardStatements: [statement({ id: 'statement', card_id: 'card', statement_debt_amount: 3000 })],
      }),
      FROM,
      { from: FROM },
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'card_statement', action: 'pay_card_statement', amount: 3000 })
  })

  it('marks credit-card automatic payments as non-cash obligations', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'credit-card', card_type: 'kredi_karti', bank_name: 'Banka', card_name: 'Kart' })],
        payments: [
          payment({
            id: 'icloud',
            title: 'iCloud+',
            amount: 130,
            due_date: '2026-06-11',
            payment_method: 'bank_auto',
            auto_source_card_id: 'credit-card',
          }),
        ],
      }),
      FROM,
      { from: FROM },
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'payment',
      amount: 130,
      cashImpactAmount: 0,
      settlement: 'credit_card',
      relatedCardId: 'credit-card',
    })
  })

  it('summarizes monthly totals from cash impact, not raw card-settled load', () => {
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'credit-card', card_type: 'kredi_karti', due_day: 20 })],
        payments: [
          payment({ id: 'cash-payment', amount: 500, due_date: '2026-06-10' }),
          payment({
            id: 'card-payment',
            amount: 200,
            due_date: '2026-06-10',
            payment_method: 'bank_auto',
            auto_source_card_id: 'credit-card',
          }),
        ],
        cardInstallments: [
          cardInstallment({ id: 'future-card-load', card_id: 'credit-card', due_month: '2026-06-01', amount: 300 }),
        ],
      }),
      FROM,
      { from: FROM },
    )

    expect(summarizeFinanceObligations(items)).toMatchObject({
      outflow: 500,
      inflow: 0,
      net: -500,
      payableCount: 2,
      itemCount: 3,
    })
  })

  it('places card installments on their due date and legacy loan estimates on their calendar days', () => {
    const july = new Date(2026, 6, 1)
    const items = buildFinanceObligationsForMonth(
      input({
        cards: [card({ id: 'card', card_type: 'kredi_karti', due_day: 12 })],
        cardInstallments: [cardInstallment({ id: 'installment', card_id: 'card', due_month: '2026-07-15', amount: 400 })],
        loans: [loan({ id: 'legacy', monthly_payment: 2000, installment_day: 7, remaining_installments: 2 })],
      }),
      july,
      { from: FROM },
    )

    expect(items.map((item) => [item.kind, item.date, item.amount, item.action])).toEqual([
      ['legacy_loan_installment', '2026-07-07', 2000, null],
      ['card_installment', '2026-07-15', 400, null],
    ])
    expect(items.find((item) => item.kind === 'card_installment')).toMatchObject({ cashImpactAmount: 0, settlement: 'credit_card' })
  })

  it('builds a short range from the same obligation source of truth', () => {
    const items = buildFinanceObligationsForRange(
      input({
        payments: [
          payment({
            id: 'rent',
            title: 'Kira',
            amount: 5000,
            due_date: '2026-01-05',
            recurrence: 'monthly',
            recurrence_day: 5,
          }),
        ],
        cards: [card({ id: 'card', card_type: 'kredi_karti', statement_day: 1, due_day: 10, statement_debt_amount: 3000 })],
        cardStatements: [statement({ id: 'statement', card_id: 'card', statement_debt_amount: 3000, due_date: '2026-06-10' })],
      }),
      { from: new Date(2026, 5, 1), days: 14 },
    )

    expect(items.map((item) => [item.kind, item.date, item.amount])).toEqual([
      ['payment', '2026-06-05', 5000],
      ['card_statement', '2026-06-10', 3000],
    ])
  })

  it('does not include obligations outside the requested range', () => {
    const items = buildFinanceObligationsForRange(
      input({
        payments: [
          payment({ id: 'inside', amount: 100, due_date: '2026-06-03' }),
          payment({ id: 'outside', amount: 200, due_date: '2026-07-03' }),
        ],
      }),
      { from: new Date(2026, 5, 1), days: 10 },
    )

    expect(items.map((item) => item.sourceId)).toEqual(['inside'])
  })
})

// Guards the "wrong month" bug class (regression: c1bf46f put current-period
// spending in the spending month instead of the next cycle). Every cash-impacting
// obligation must land on a billing-cycle-correct date. Card statement debt is
// counted on its next due date; current-period spending one cycle later.
describe('cash-impacting obligation date placement (billing-cycle correctness)', () => {
  const creditFrom = new Date(2026, 5, 1) // 1 June 2026

  function creditCard(overrides: Partial<Card>): Card {
    return card({ card_type: 'kredi_karti', statement_day: 15, due_day: 25, ...overrides })
  }

  function cardDebtItems(data: FinanceObligationsInput, month: Date, from = creditFrom) {
    return buildFinanceObligationsForMonth(data, month, { from }).filter((item) => item.kind === 'card_debt')
  }

  it('places statement debt on its due date and current-period spending one cycle later (due_day > statement_day)', () => {
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 15, due_day: 25, statement_debt_amount: 3000, current_period_spending: 1000 })],
    })

    expect(cardDebtItems(data, new Date(2026, 5, 1)).map((i) => [i.date, i.amount, i.action]))
      .toEqual([['2026-06-25', 3000, 'pay_card_debt']])
    expect(cardDebtItems(data, new Date(2026, 6, 1)).map((i) => [i.date, i.amount, i.action]))
      .toEqual([['2026-07-25', 1000, null]])
  })

  it('keeps the same one-cycle separation when the due day precedes the statement day (typical TR card)', () => {
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 26, due_day: 6, statement_debt_amount: 3000, current_period_spending: 1000 })],
    })

    expect(cardDebtItems(data, new Date(2026, 5, 1)).map((i) => [i.date, i.amount])).toEqual([['2026-06-06', 3000]])
    expect(cardDebtItems(data, new Date(2026, 6, 1)).map((i) => [i.date, i.amount])).toEqual([['2026-07-06', 1000]])
  })

  it('never reports statement debt and current-period spending in the same month', () => {
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 10, due_day: 20, statement_debt_amount: 2000, current_period_spending: 500 })],
    })

    const monthly = [0, 1, 2, 3].map((offset) => cardDebtItems(data, new Date(2026, 5 + offset, 1)))

    // No month may carry both the statement-debt and the current-period card_debt for one card.
    for (const monthItems of monthly) expect(monthItems.length).toBeLessThanOrEqual(1)
    expect(monthly[0].map((i) => i.amount)).toEqual([2000]) // June: statement debt
    expect(monthly[1].map((i) => i.amount)).toEqual([500]) // July: current-period, one cycle later
  })

  it('places current-period on the next due date when no statement is pending (statement_debt = 0)', () => {
    // Kullanıcının kartı gibi: kesim 4, son ödeme 14 (due_day > statement_day),
    // kesilmiş ekstre yok. Açık dönem bir sonraki son ödeme gününde (14 Haz) ödenir,
    // bir çevrim sonra (14 Tem) DEĞİL.
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 4, due_day: 14, statement_debt_amount: 0, current_period_spending: 1000 })],
    })

    expect(cardDebtItems(data, new Date(2026, 5, 1)).map((i) => [i.date, i.amount, i.action]))
      .toEqual([['2026-06-14', 1000, null]])
    // bir çevrim sonra boş
    expect(cardDebtItems(data, new Date(2026, 6, 1))).toEqual([])
  })

  it('moves current-period spending to the next cycle after the statement day has passed', () => {
    // 4 Temmuz ekstresi ödendikten sonra 14 Temmuz hâlâ eski ekstrenin vadesidir.
    // 8 Temmuz'daki dönem içi borç açık döneme aittir ve Ağustos vadesine gider.
    const from = new Date(2026, 6, 8)
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 4, due_day: 14, statement_debt_amount: 0, current_period_spending: 1000 })],
      cardStatements: [
        statement({
          id: 'paid-july-statement',
          card_id: 'c',
          statement_date: '2026-07-04',
          due_date: '2026-07-14',
          statement_debt_amount: 3000,
          status: 'paid',
          paid_at: '2026-07-04T12:00:00.000Z',
        }),
      ],
    })

    expect(cardDebtItems(data, new Date(2026, 6, 1), from)).toEqual([])
    expect(cardDebtItems(data, new Date(2026, 7, 1), from).map((i) => [i.date, i.amount, i.action]))
      .toEqual([['2026-08-14', 1000, null]])
  })

  it('uses the statement-derived due date when the due day precedes the statement day', () => {
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 26, due_day: 6, statement_debt_amount: 0, current_period_spending: 1000 })],
    })

    expect(cardDebtItems(data, new Date(2026, 5, 1)).map((i) => [i.date, i.amount, i.action]))
      .toEqual([])
    expect(cardDebtItems(data, new Date(2026, 6, 1)).map((i) => [i.date, i.amount, i.action]))
      .toEqual([['2026-07-06', 1000, null]])
  })

  it('still defers current-period one cycle when a statement is pending (statement_debt > 0)', () => {
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 4, due_day: 14, statement_debt_amount: 3000, current_period_spending: 1000 })],
    })
    // Bekleyen ekstre 14 Haz'da ödenir; açık dönem bir sonraki çevrimde (14 Tem).
    expect(cardDebtItems(data, new Date(2026, 5, 1)).map((i) => [i.amount, i.action])).toEqual([[3000, 'pay_card_debt']])
    expect(cardDebtItems(data, new Date(2026, 6, 1)).map((i) => [i.date, i.amount, i.action])).toEqual([['2026-07-14', 1000, null]])
  })

  it('clamps the current-period due date at month end across a short month', () => {
    const data = input({
      cards: [creditCard({ id: 'c', statement_day: 31, due_day: 31, statement_debt_amount: 3000, current_period_spending: 1000 })],
    })

    expect(cardDebtItems(data, new Date(2026, 1, 1), new Date(2026, 0, 1)).map((i) => [i.date, i.amount, i.action]))
      .toEqual([['2026-02-28', 1000, null]])
  })

  it('treats card installments as non-cash on their own due date', () => {
    const data = input({
      cards: [card({ id: 'c', card_type: 'kredi_karti', due_day: 31 })],
      cardInstallments: [cardInstallment({ id: 'i', card_id: 'c', due_month: '2026-02-28', amount: 400 })],
    })
    const items = buildFinanceObligationsForMonth(data, new Date(2026, 1, 1), { from: new Date(2026, 1, 1) })

    expect(items.find((i) => i.kind === 'card_installment')).toMatchObject({
      date: '2026-02-28',
      cashImpactAmount: 0,
      settlement: 'credit_card',
    })
    expect(summarizeFinanceObligations(items).outflow).toBe(0)
  })
})
