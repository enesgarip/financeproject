import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Budget, Card, CardExpense, CardInstallment, Debt, Payment } from '../types/database'
import {
  buildCalendarEvents,
  buildCategoryInsights,
  calendarEventCashDelta,
  calendarEventsCashDelta,
  analysisFinanceSummaryInput,
  buildSearchCsv,
  buildSearchItems,
  formatMonth,
  monthKeyFor,
  previousMonthKeys,
  type AnalysisData,
  type SearchItem,
} from './analysisView'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }

const emptyData: AnalysisData = {
  assets: [],
  cards: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  payments: [],
  salaryHistory: [],
  transactionHistory: [],
  cardExpenses: [],
  cardInstallments: [],
  cardStatementArchives: [],
  budgets: [],
  savingsGoals: [],
}

function data(overrides: Partial<AnalysisData>): AnalysisData {
  return { ...emptyData, ...overrides }
}

function asset(overrides: Partial<Asset>): Asset {
  return {
    ...base,
    name: 'Varlık',
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
    ...base,
    bank_name: 'Banka',
    card_name: 'Kart',
    card_type: 'kredi_karti',
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

function expense(overrides: Partial<CardExpense>): CardExpense {
  return {
    ...base,
    card_id: 'c1',
    statement_archive_id: null,
    spent_at: '2026-06-10',
    amount: 0,
    description: 'Harcama',
    category: 'Market',
    installment_count: 1,
    installment_amount: 0,
    status: 'posted',
    posted_at: null,
    note: null,
    ...overrides,
    transaction_fingerprint: overrides.transaction_fingerprint ?? null,
  }
}

function budget(overrides: Partial<Budget>): Budget {
  return { ...base, month: '2026-06-01', category: 'Market', limit_amount: 1000, note: null, ...overrides }
}

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base,
    person_name: 'Ali',
    direction: 'borç_aldım',
    value_type: 'TRY',
    currency: null,
    amount: 0,
    estimated_value_try: 0,
    auto_valued: false,
    valuation: 'manual',
    status: 'açık',
    due_date: null,
    note: null,
    ...overrides,
  } as Debt
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base,
    title: 'Odeme',
    category: 'Fatura',
    amount: 0,
    amount_status: 'exact',
    due_date: '2026-06-10',
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

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return {
    ...base,
    card_id: 'cc',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 3,
    due_month: '2026-06-01',
    amount: 0,
    description: 'Taksit',
    category: 'Diger',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    ...overrides,
  }
}

describe('formatMonth', () => {
  it('renders a Turkish "month year" label from an ISO date', () => {
    expect(formatMonth('2026-06-01')).toBe('Haziran 2026')
  })
})

describe('monthKeyFor', () => {
  it('normalizes any date in a month to its first-day key', () => {
    expect(monthKeyFor('2026-06-17')).toBe('2026-06-01')
  })

  it('falls back to the current month for an invalid date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 12))
    expect(monthKeyFor('not-a-date')).toBe('2026-06-01')
    vi.useRealTimers()
  })
})

describe('previousMonthKeys', () => {
  it('returns the N months before the current one, newest first', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 12))
    expect(previousMonthKeys(3)).toEqual(['2026-05-01', '2026-04-01', '2026-03-01'])
    vi.useRealTimers()
  })
})

describe('buildSearchItems', () => {
  it('maps every domain row into a typed search item, newest date first', () => {
    const items = buildSearchItems(
      data({
        assets: [asset({ name: 'Altın', category: 'Altın', estimated_value_try: 5000, updated_at: '2026-06-05' })],
        cards: [card({ bank_name: 'X', card_name: 'Y', card_type: 'kredi_karti', debt_amount: 1200, updated_at: '2026-06-09' })],
        debts: [debt({ person_name: 'Ali', direction: 'borç_verdim', estimated_value_try: 300, due_date: '2026-06-01' })],
      }),
    )

    // Sorted by date desc: card (06-09) → asset (06-05) → debt (06-01)
    expect(items.map((item) => item.type)).toEqual(['Kart', 'Varlık', 'Alacak'])
    expect(items.map((item) => item.title)).toEqual(['X Y', 'Altın', 'Ali'])
    expect(items[0]).toMatchObject({ type: 'Kart', amount: 1200 })
    expect(items[2]).toMatchObject({ type: 'Alacak', amount: 300 })
  })

  it('labels a debit-direction debt as Borç', () => {
    const [item] = buildSearchItems(data({ debts: [debt({ direction: 'borç_aldım' })] }))
    expect(item.type).toBe('Borç')
  })
})

describe('buildSearchCsv', () => {
  it('emits a header row and quotes/escapes every cell', () => {
    const items: SearchItem[] = [
      { type: 'Kart', title: 'X "Y"', subtitle: 'Kredi kartı', amount: 1200, date: '2026-06-09' },
      { type: 'Ödeme', title: 'Kira', subtitle: 'Kira / aidat', amount: null, date: null },
    ]
    const csv = buildSearchCsv(items)
    const lines = csv.split('\n')

    expect(lines[0]).toBe('"Tur","Baslik","Detay","Tutar","Tarih"')
    // Embedded double-quotes are doubled.
    expect(lines[1]).toBe('"Kart","X ""Y""","Kredi kartı","1200","2026-06-09"')
    // Null amount/date become empty quoted cells.
    expect(lines[2]).toBe('"Ödeme","Kira","Kira / aidat","",""')
  })
})

describe('analysisFinanceSummaryInput', () => {
  it('carries statement archives into forecast/summary projections', () => {
    const source = data({
      cards: [card({ id: 'cc', statement_debt_amount: 5000 })],
      cardStatementArchives: [{
        ...base,
        card_id: 'cc',
        period_year: 2026,
        period_month: 6,
        statement_date: '2026-06-01',
        due_date: '2026-06-10',
        statement_debt_amount: 3000,
        current_period_spending: 0,
        total_debt_amount: 5000,
        status: 'open',
        paid_at: null,
        payment_source_card_id: null,
        reconciled_bank_amount: null,
        reconciled_at: null,
        reconciliation_note: null,
        note: null,
      }],
    })

    expect(analysisFinanceSummaryInput(source).cardStatements).toEqual(source.cardStatementArchives)
  })
})

describe('buildCalendarEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves cash impact and settlement for calendar totals', () => {
    const source = data({
      cards: [card({ id: 'cc', card_name: 'World', due_day: 20 })],
      payments: [
        payment({
          id: 'p-card',
          title: 'Dijital uyelik',
          amount: 200,
          payment_method: 'bank_auto',
          auto_source_card_id: 'cc',
        }),
        payment({ id: 'p-cash', title: 'Kira', amount: 500 }),
      ],
      cardInstallments: [cardInstallment({ id: 'i1', amount: 300, description: 'Telefon taksidi' })],
      debts: [debt({ id: 'd1', person_name: 'Ayse', direction: 'borç_verdim', estimated_value_try: 100, due_date: '2026-06-10' })],
    })

    const events = buildCalendarEvents(source)
    const cardPayment = events.find((event) => event.id.startsWith('payment-p-card-'))
    const cardInstallmentEvent = events.find((event) => event.id === 'card-installment-i1')
    const cashPayment = events.find((event) => event.id.startsWith('payment-p-cash-'))
    const receivable = events.find((event) => event.id === 'debt-d1')

    expect(cardPayment).toMatchObject({
      amount: 200,
      cashImpactAmount: 0,
      direction: 'outflow',
      settlement: 'credit_card',
      tone: 'stone',
    })
    expect(cardInstallmentEvent).toMatchObject({
      amount: 300,
      cashImpactAmount: 0,
      direction: 'outflow',
      settlement: 'credit_card',
      tone: 'stone',
    })
    expect(cashPayment).toMatchObject({
      amount: 500,
      cashImpactAmount: 500,
      direction: 'outflow',
      settlement: 'cash',
      tone: 'rose',
    })
    expect(receivable).toMatchObject({
      amount: 100,
      cashImpactAmount: 100,
      direction: 'inflow',
      settlement: 'cash',
      tone: 'emerald',
    })
  })

  it('computes calendar day totals from cash impact, not raw card load', () => {
    const source = data({
      cards: [card({ id: 'cc', due_day: 20 })],
      payments: [
        payment({
          id: 'p-card',
          amount: 200,
          payment_method: 'bank_auto',
          auto_source_card_id: 'cc',
        }),
        payment({ id: 'p-cash', amount: 500 }),
      ],
      debts: [debt({ id: 'd1', direction: 'borç_verdim', estimated_value_try: 100, due_date: '2026-06-10' })],
    })

    const dayEvents = buildCalendarEvents(source).filter((event) => event.date === '2026-06-10')
    const cardPayment = dayEvents.find((event) => event.id.startsWith('payment-p-card-'))

    expect(cardPayment ? calendarEventCashDelta(cardPayment) : null).toBe(0)
    expect(calendarEventsCashDelta(dayEvents)).toBe(-400)
  })
})

describe('buildCategoryInsights', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 12))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags an over-limit category for the current month', () => {
    const insights = buildCategoryInsights(
      data({
        budgets: [budget({ category: 'Market', month: '2026-06-01', limit_amount: 1000 })],
        cardExpenses: [expense({ category: 'Market', amount: 1200, spent_at: '2026-06-08' })],
      }),
    )

    expect(insights).toHaveLength(1)
    expect(insights[0]).toMatchObject({ category: 'Market', title: 'Bütçe aşıldı', priority: 1, amount: 1200 })
  })

  it('flags spending well above the 3-month average', () => {
    const insights = buildCategoryInsights(
      data({
        cardExpenses: [
          expense({ category: 'Eğlence', amount: 900, spent_at: '2026-06-05' }),
          expense({ category: 'Eğlence', amount: 300, spent_at: '2026-05-05' }),
          expense({ category: 'Eğlence', amount: 300, spent_at: '2026-04-05' }),
          expense({ category: 'Eğlence', amount: 300, spent_at: '2026-03-05' }),
        ],
      }),
    )

    expect(insights[0]).toMatchObject({ category: 'Eğlence', title: 'Son 3 ay ortalamasının üstünde' })
  })

  it('ignores expenses outside the current month when there is no budget', () => {
    const insights = buildCategoryInsights(
      data({ cardExpenses: [expense({ category: 'Market', amount: 500, spent_at: '2026-05-10' })] }),
    )
    expect(insights).toEqual([])
  })
})
