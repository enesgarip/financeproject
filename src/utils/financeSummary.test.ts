import { describe, expect, it } from 'vitest'
import type { Asset, Card, CardInstallment, Debt, Loan, LoanInstallment, Payment, SalaryHistory, SavingsGoal } from '../types/database'
import {
  buildCreditLimitGroups,
  buildFinancialHealth,
  buildFinancialPosition,
  buildGoalProgressSummary,
  buildMonthlyCashFlow,
  cardDebtBreakdown,
  cardPayableDebt,
  cardProvisionAmount,
  cardSplitTotal,
  clampCardBreakdown,
  expectedInstallmentAmount,
  projectLoanSummary,
  scheduledCardInstallmentTotalsByCard,
  getCurrentSalary,
  getSalaryForDate,
  getSalaryTrend,
  paymentCashOutflowAmount,
  paymentOccurrenceInMonth,
  sum,
  totalCreditLimit,
} from './financeSummary'
import { roundTL } from './money'

const base = { id: 'id', user_id: 'u', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const JUNE = new Date(2026, 5, 15) // June 15, 2026

// ── Factories ──────────────────────────────────────────────────────────────

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: null, symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, source: null, note: null, ...overrides }
}

function bankCard(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka', card_name: 'Banka Kartı', card_type: 'banka_karti',
    holder_name: null, limit_group_name: null,
    current_balance: 0, credit_limit: 0, debt_amount: 0,
    statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0,
    statement_day: null, due_day: null, note: null, ...overrides,
  }
}

function creditCard(overrides: Partial<Card>): Card {
  return {
    ...base,
    bank_name: 'Banka', card_name: 'Kredi Kartı', card_type: 'kredi_karti',
    holder_name: null, limit_group_name: null,
    current_balance: 0, credit_limit: 10000, debt_amount: 0,
    statement_debt_amount: 0, current_period_spending: 0, provision_amount: 0,
    statement_day: 1, due_day: 10, note: null, ...overrides,
  }
}

function loan(overrides: Partial<Loan>): Loan {
  return {
    ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0,
    monthly_payment: 0, installment_day: null, start_date: null, end_date: null,
    remaining_installments: 0, status: 'active', note: null, ...overrides,
  }
}

function loanInstallment(overrides: Partial<LoanInstallment>): LoanInstallment {
  return { ...base, loan_id: 'l1', installment_no: 1, due_date: '2026-06-10', amount: 0, status: 'bekliyor', paid_at: null, note: null, ...overrides }
}

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return {
    ...base,
    card_id: 'c1',
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

function debt(overrides: Partial<Debt>): Debt {
  return {
    ...base, person_name: 'Kişi', direction: 'borç_aldım', value_type: 'TRY',
    currency: null, amount: 0, estimated_value_try: 0, auto_valued: false,
    due_date: null, status: 'açık', note: null, ...overrides,
  }
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    ...base, title: 'Ödeme', category: 'Fatura', amount: 0,
    amount_status: 'exact', due_date: '2026-06-15', status: 'bekliyor',
    payment_method: 'manual', recurrence: 'none', recurrence_day: null,
    recurrence_end_date: null, auto_source_card_id: null, note: null, ...overrides,
  }
}

function salary(overrides: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 0, effective_date: '2026-01-01', note: null, ...overrides }
}

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    ...base, name: 'Hedef', value_type: 'TRY', target_amount: 0, current_amount: 0,
    estimated_value_try: null, auto_valued: false, target_date: null, status: 'active', note: null, ...overrides,
  }
}

const emptyInput = {
  assets: [], cards: [], loans: [], loanInstallments: [], debts: [],
  payments: [], salaryHistory: [], cardInstallments: [], savingsGoals: [], savingsGoalComponents: [],
}

// ── Pure helpers ───────────────────────────────────────────────────────────

describe('sum', () => {
  it('reduces an array with a selector', () => {
    expect(sum([{ v: 1 }, { v: 2 }, { v: 3 }], (x) => x.v)).toBe(6)
  })
  it('sums TL values through kurus instead of leaking float dust', () => {
    expect(sum([{ v: 0.1 }, { v: 0.2 }], (x) => x.v)).toBe(0.3)
  })
  it('returns 0 for empty array', () => {
    expect(sum([], (x: { v: number }) => x.v)).toBe(0)
  })
})

describe('cardProvisionAmount', () => {
  it('returns provision_amount', () => {
    expect(cardProvisionAmount({ provision_amount: 250 })).toBe(250)
  })
  it('returns 0 when null', () => {
    expect(cardProvisionAmount({ provision_amount: null as unknown as number })).toBe(0)
  })
})

describe('cardSplitTotal', () => {
  it('sums statement + current + provision', () => {
    expect(cardSplitTotal(1000, 300, 50)).toBe(1350)
  })
  it('keeps split totals at exact kurus precision', () => {
    expect(cardSplitTotal(0.1, 0.2, 0.3)).toBe(0.6)
  })
})

describe('scheduledCardInstallmentTotalsByCard', () => {
  it('sums only scheduled card installments by card at kurus precision', () => {
    const totals = scheduledCardInstallmentTotalsByCard([
      cardInstallment({ id: 'i1', card_id: 'c1', amount: 0.1 }),
      cardInstallment({ id: 'i2', card_id: 'c1', amount: 0.2 }),
      cardInstallment({ id: 'i3', card_id: 'c1', amount: 99, status: 'posted' }),
      cardInstallment({ id: 'i4', card_id: 'c2', amount: 10 }),
    ])

    expect(totals.get('c1')).toBe(0.3)
    expect(totals.get('c2')).toBe(10)
  })
})

describe('cardDebtBreakdown', () => {
  it('flags split totals that exceed stored card debt', () => {
    const breakdown = cardDebtBreakdown(creditCard({
      debt_amount: 100,
      statement_debt_amount: 80,
      current_period_spending: 30,
      provision_amount: 0,
    }))

    expect(breakdown.splitTotal).toBe(110)
    expect(breakdown.hasSplitOverflow).toBe(true)
    expect(breakdown.hasScheduledDebtGap).toBe(false)
    expect(breakdown.hasUnexplainedDebt).toBe(false)
  })

  it('flags scheduled installments that are not reflected in card debt', () => {
    const breakdown = cardDebtBreakdown(creditCard({
      debt_amount: 250,
      statement_debt_amount: 200,
      current_period_spending: 50,
      provision_amount: 0,
    }), 0.1 + 0.2)

    expect(breakdown.scheduledTotal).toBe(0.3)
    expect(breakdown.nextDebtAmount).toBe(250.3)
    expect(breakdown.hasScheduledDebtGap).toBe(true)
    expect(breakdown.hasUnexplainedDebt).toBe(false)
  })

  it('separates scheduled future debt from unexplained card debt', () => {
    const breakdown = cardDebtBreakdown(creditCard({
      debt_amount: 500,
      statement_debt_amount: 100,
      current_period_spending: 100,
      provision_amount: 50,
    }), 200)

    expect(breakdown.splitTotal).toBe(250)
    expect(breakdown.unclassifiedAmount).toBe(250)
    expect(breakdown.unexplainedAmount).toBe(50)
    expect(breakdown.hasScheduledDebtGap).toBe(false)
    expect(breakdown.hasUnexplainedDebt).toBe(true)
  })
})

describe('cardPayableDebt', () => {
  it('sums statement + current period', () => {
    const card = creditCard({ statement_debt_amount: 800, current_period_spending: 200 })
    expect(cardPayableDebt(card)).toBe(1000)
  })
  it('clamps to 0 when negative sum', () => {
    const card = creditCard({ statement_debt_amount: -100, current_period_spending: 50 })
    expect(cardPayableDebt(card)).toBe(0)
  })
})

describe('clampCardBreakdown', () => {
  it('leaves a consistent breakdown untouched (no-op when split <= debt)', () => {
    expect(clampCardBreakdown(100, 50, 30, 20)).toEqual({ statement: 50, provision: 20, current: 30 })
  })

  it('clamps the pay_card_debt over-payment case so split equals debt', () => {
    // debt 100 = 50/30/20, pay 60 → debt 40, statement 0 (RPC), current/provision stale.
    const out = clampCardBreakdown(40, 0, 30, 20)
    expect(out).toEqual({ statement: 0, provision: 20, current: 20 })
    expect(out.statement + out.provision + out.current).toBe(40)
  })

  it('protects statement first, then provision, then shrinks current last', () => {
    // statement alone already exceeds debt → it absorbs everything, rest zeroed.
    expect(clampCardBreakdown(40, 100, 30, 20)).toEqual({ statement: 40, provision: 0, current: 0 })
    // statement fits, provision takes the remainder, current is squeezed out.
    expect(clampCardBreakdown(40, 10, 30, 50)).toEqual({ statement: 10, provision: 30, current: 0 })
  })

  it('floors negatives and a negative debt at zero', () => {
    expect(clampCardBreakdown(100, -10, -5, -20)).toEqual({ statement: 0, provision: 0, current: 0 })
    expect(clampCardBreakdown(-50, 10, 10, 10)).toEqual({ statement: 0, provision: 0, current: 0 })
  })

  it('clamps in integer kurus when decimal dust would otherwise matter', () => {
    const out = clampCardBreakdown(0.3, 0.1, 0.2, 0.1)
    expect(out).toEqual({ statement: 0.1, provision: 0.1, current: 0.1 })
    expect(out.statement + out.provision + out.current).toBeCloseTo(0.3)
  })
})

describe('projectLoanSummary', () => {
  it('sums only unpaid installments and stays active while any remain', () => {
    expect(
      projectLoanSummary([
        { amount: 100, status: 'ödendi' },
        { amount: 250, status: 'bekliyor' },
        { amount: 250, status: 'bekliyor' },
      ]),
    ).toEqual({ remainingAmount: 500, remainingInstallments: 2, status: 'active' })
  })

  it('closes the loan when every installment is paid', () => {
    expect(
      projectLoanSummary([
        { amount: 100, status: 'ödendi' },
        { amount: 100, status: 'ödendi' },
      ]),
    ).toEqual({ remainingAmount: 0, remainingInstallments: 0, status: 'closed' })
  })

  it('treats an empty plan as closed with nothing remaining', () => {
    expect(projectLoanSummary([])).toEqual({ remainingAmount: 0, remainingInstallments: 0, status: 'closed' })
  })
})

describe('expectedInstallmentAmount', () => {
  it('returns the full amount for single-shot expenses', () => {
    expect(expectedInstallmentAmount(1200, 1)).toBe(1200)
    expect(expectedInstallmentAmount(1200, 0)).toBe(1200)
  })

  it('divides evenly across installments, rounded to kuruş', () => {
    expect(expectedInstallmentAmount(1200, 3)).toBe(400)
    expect(expectedInstallmentAmount(100, 3)).toBe(33.33)
    expect(expectedInstallmentAmount(2000, 12)).toBe(166.67)
  })

  it('matches the SQL twin: round(amount/count, 2)', () => {
    // 0.1+0.2 türü float tozu roundTL ile temizlenir
    expect(expectedInstallmentAmount(0.3, 3)).toBe(0.1)
  })
})

// ── Credit limit groups ────────────────────────────────────────────────────

describe('totalCreditLimit', () => {
  it('sums max limit per group', () => {
    // Two cards sharing same limit_group_name — limit should be max, not sum
    const c1 = creditCard({ id: 'c1', limit_group_name: 'A', credit_limit: 20000, debt_amount: 0 })
    const c2 = creditCard({ id: 'c2', limit_group_name: 'A', credit_limit: 15000, debt_amount: 0 })
    const c3 = creditCard({ id: 'c3', limit_group_name: null, credit_limit: 5000, debt_amount: 0 })
    // Group A contributes 20000 (max), c3 alone contributes 5000 → total 25000
    expect(totalCreditLimit([c1, c2, c3])).toBe(25000)
  })

  it('ignores banka_karti', () => {
    const b = bankCard({ id: 'b1', credit_limit: 9999 })
    expect(totalCreditLimit([b])).toBe(0)
  })
})

describe('buildCreditLimitGroups', () => {
  it('groups cards by limit_group_name and uses max limit', () => {
    const c1 = creditCard({ id: 'c1', limit_group_name: 'Yapı', credit_limit: 20000, debt_amount: 5000 })
    const c2 = creditCard({ id: 'c2', limit_group_name: 'Yapı', credit_limit: 15000, debt_amount: 3000 })
    const groups = buildCreditLimitGroups([c1, c2])
    expect(groups).toHaveLength(1)
    expect(groups[0].limit).toBe(20000)
    expect(groups[0].debt).toBe(8000)
    expect(groups[0].available).toBe(12000)
    expect(groups[0].usageRate).toBeCloseTo(40)
  })

  it('carries the full debt breakdown for shared-limit UI and health checks', () => {
    const c1 = creditCard({
      id: 'c1',
      limit_group_name: 'Shared',
      credit_limit: 20000,
      debt_amount: 5000,
      statement_debt_amount: 2500,
      current_period_spending: 1000,
      provision_amount: 250,
    })
    const c2 = creditCard({
      id: 'c2',
      limit_group_name: ' Shared ',
      credit_limit: 15000,
      debt_amount: 3000,
      statement_debt_amount: 500,
      current_period_spending: 750,
      provision_amount: null as unknown as number,
    })

    const groups = buildCreditLimitGroups([c1, c2])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      key: 'Shared',
      label: 'Shared',
      limit: 20000,
      debt: 8000,
      statementDebt: 3000,
      currentPeriod: 1750,
      provision: 250,
      available: 12000,
      isShared: true,
    })
  })

  it('treats each ungrouped card as its own group', () => {
    const c1 = creditCard({ id: 'c1', limit_group_name: null, credit_limit: 10000, debt_amount: 0 })
    const c2 = creditCard({ id: 'c2', limit_group_name: null, credit_limit: 5000, debt_amount: 0 })
    expect(buildCreditLimitGroups([c1, c2])).toHaveLength(2)
  })

  it('sorts by debt descending', () => {
    const c1 = creditCard({ id: 'c1', limit_group_name: null, credit_limit: 10000, debt_amount: 1000 })
    const c2 = creditCard({ id: 'c2', limit_group_name: null, credit_limit: 10000, debt_amount: 5000 })
    const groups = buildCreditLimitGroups([c1, c2])
    expect(groups[0].debt).toBe(5000)
  })
})

// ── Salary ─────────────────────────────────────────────────────────────────

describe('getCurrentSalary', () => {
  it('returns the latest salary on or before today', () => {
    const past = salary({ id: 's1', effective_date: '2025-01-01', amount: 50000 })
    const recent = salary({ id: 's2', effective_date: '2026-01-01', amount: 70000 })
    const future = salary({ id: 's3', effective_date: '2030-01-01', amount: 99999 })
    const result = getCurrentSalary([past, recent, future])
    expect(result?.id).toBe('s2')
  })

  it('falls back to earliest when all are future', () => {
    const future = salary({ id: 'f1', effective_date: '2099-01-01', amount: 1 })
    expect(getCurrentSalary([future])?.id).toBe('f1')
  })

  it('returns null for empty array', () => {
    expect(getCurrentSalary([])).toBeNull()
  })
})

describe('getSalaryForDate', () => {
  it('returns the salary effective at the requested date', () => {
    const rows = [
      salary({ id: 's1', effective_date: '2026-01-01', amount: 50000 }),
      salary({ id: 's2', effective_date: '2026-04-15', amount: 60000 }),
      salary({ id: 's3', effective_date: '2026-08-01', amount: 70000 }),
    ]

    expect(getSalaryForDate(rows, new Date(2026, 2, 31))?.id).toBe('s1')
    expect(getSalaryForDate(rows, '2026-04-30')?.id).toBe('s2')
  })

  it('returns null before the first known effective date', () => {
    expect(getSalaryForDate([salary({ effective_date: '2026-06-01', amount: 50000 })], '2026-05-31')).toBeNull()
  })
})

describe('getSalaryTrend', () => {
  it('calculates percentage change between last two salaries', () => {
    const rows = [
      salary({ effective_date: '2025-01-01', amount: 50000 }),
      salary({ effective_date: '2026-01-01', amount: 60000 }),
    ]
    const trend = getSalaryTrend(rows)
    expect(trend.difference).toBe(10000)
    expect(trend.percentage).toBeCloseTo(20)
  })

  it('returns 0 percentage when only one row', () => {
    const trend = getSalaryTrend([salary({ amount: 50000 })])
    expect(trend.percentage).toBe(0)
  })
})

// ── Payment occurrence ─────────────────────────────────────────────────────

describe('paymentOccurrenceInMonth', () => {
  it('returns null when status is not bekliyor', () => {
    const p = payment({ due_date: '2026-06-15', status: 'ödendi' })
    expect(paymentOccurrenceInMonth(p, JUNE)).toBeNull()
  })

  it('returns occurrence for non-recurring payment in the same month', () => {
    const p = payment({ due_date: '2026-06-20', recurrence: 'none' })
    expect(paymentOccurrenceInMonth(p, JUNE)).not.toBeNull()
  })

  it('returns null for non-recurring payment in a different month', () => {
    const p = payment({ due_date: '2026-05-20', recurrence: 'none' })
    expect(paymentOccurrenceInMonth(p, JUNE)).toBeNull()
  })

  it('returns occurrence for monthly payment whose start is before the month', () => {
    const p = payment({
      recurrence: 'monthly', recurrence_day: 15,
      due_date: '2026-01-15', recurrence_end_date: null,
    })
    expect(paymentOccurrenceInMonth(p, JUNE)).not.toBeNull()
  })

  it('returns null for monthly payment when start date is after the month', () => {
    const p = payment({
      recurrence: 'monthly', recurrence_day: 10,
      due_date: '2026-07-10', recurrence_end_date: null,
    })
    expect(paymentOccurrenceInMonth(p, JUNE)).toBeNull()
  })

  it('returns null for monthly payment past its end date', () => {
    const p = payment({
      recurrence: 'monthly', recurrence_day: 15,
      due_date: '2025-01-15', recurrence_end_date: '2026-05-31',
    })
    expect(paymentOccurrenceInMonth(p, JUNE)).toBeNull()
  })
})

// ── buildFinancialPosition ─────────────────────────────────────────────────

describe('paymentCashOutflowAmount', () => {
  it('keeps manual payments as cash outflow', () => {
    expect(paymentCashOutflowAmount(payment({ amount: 1200, payment_method: 'manual' }))).toBe(1200)
  })

  it('removes credit-card automatic payments from immediate cash outflow', () => {
    expect(paymentCashOutflowAmount(payment({ amount: 1200, payment_method: 'bank_auto', auto_source_card_id: 'credit-card' }))).toBe(0)
  })
})

describe('buildFinancialPosition', () => {
  it('returns zero net worth for empty input', () => {
    const pos = buildFinancialPosition(emptyInput)
    expect(pos.netWorth).toBe(0)
    expect(pos.totalCashAssets).toBe(0)
  })

  it('includes bank card balances in cash assets but not credit card balances', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      cards: [
        bankCard({ current_balance: 5000 }),
        creditCard({ current_balance: 0, debt_amount: 1000 }),
      ],
    })
    expect(pos.totalCashAssets).toBe(5000)
    expect(pos.totalAssets).toBe(5000) // bank balance + 0 non-cash assets
  })

  it('adds Nakit assets to cash assets', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 10000 })],
    })
    expect(pos.totalCashAssets).toBe(10000)
  })

  it('does not include non-cash assets in totalCashAssets', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      assets: [
        asset({ category: 'Nakit', estimated_value_try: 5000 }),
        asset({ category: 'Altın', estimated_value_try: 20000 }),
      ],
    })
    expect(pos.totalCashAssets).toBe(5000)
    expect(pos.totalAssets).toBe(25000)
  })

  it('calculates credit card debt breakdown correctly', () => {
    const card = creditCard({
      debt_amount: 5000,
      statement_debt_amount: 2000,
      current_period_spending: 500,
      provision_amount: 300,
    })
    const pos = buildFinancialPosition({ ...emptyInput, cards: [card] })
    expect(pos.totalCreditCardDebt).toBe(5000)
    expect(pos.totalCardStatementDebt).toBe(2000)
    expect(pos.totalCardCurrentPeriod).toBe(500)
    expect(pos.totalCardProvision).toBe(300)
    // futureInstallmentDebt = max(0, debt_amount - splitTotal)
    // splitTotal = 2000 + 500 + 300 = 2800; futureInstallment = 5000 - 2800 = 2200
    expect(pos.totalCardFutureInstallmentDebt).toBe(2200)
  })

  it('counts only active loans in totalLoanDebt', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      loans: [
        loan({ status: 'active', remaining_amount: 30000 }),
        loan({ status: 'closed', remaining_amount: 5000 }),
      ],
    })
    expect(pos.totalLoanDebt).toBe(30000)
  })

  it('separates borç_aldım and borç_verdim in debts', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      debts: [
        debt({ direction: 'borç_aldım', estimated_value_try: 2000, status: 'açık' }),
        debt({ direction: 'borç_verdim', estimated_value_try: 1000, status: 'açık' }),
        debt({ direction: 'borç_aldım', estimated_value_try: 999, status: 'kapandı' }), // ignored
      ],
    })
    expect(pos.totalPersonalDebts).toBe(2000)
    expect(pos.totalReceivables).toBe(1000)
    expect(pos.netWorthIfReceivablesCollected).toBe(roundTL(pos.netWorth + 1000))
  })

  it('includes pending payments in totalPaymentLiabilities', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      payments: [
        payment({ amount: 500, status: 'bekliyor' }),
        payment({ amount: 200, status: 'ödendi' }), // ignored
      ],
    })
    expect(pos.totalPaymentLiabilities).toBe(500)
  })

  it('excludes card-settled payments from totalPaymentLiabilities', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      payments: [
        payment({ amount: 500, status: 'bekliyor', payment_method: 'manual' }),
        payment({ amount: 300, status: 'bekliyor', payment_method: 'bank_auto', auto_source_card_id: 'card-1' }),
      ],
    })
    expect(pos.totalPaymentLiabilities).toBe(500)
  })

  it('computes netWorth as assets minus debts', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 50000 })],
      cards: [creditCard({ debt_amount: 10000, statement_debt_amount: 10000 })],
    })
    // totalAssets = 50000, totalDebts = 10000 (credit card)
    expect(pos.netWorth).toBe(40000)
  })

  it('keeps financial position totals exact at kurus precision', () => {
    const pos = buildFinancialPosition({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 0.1 })],
      cards: [
        bankCard({ current_balance: 0.2 }),
        creditCard({ debt_amount: 0.1, statement_debt_amount: 0.1 }),
      ],
    })

    expect(pos.totalAssets).toBe(0.3)
    expect(pos.totalDebts).toBe(0.1)
    expect(pos.netWorth).toBe(0.2)
  })
})

// ── buildMonthlyCashFlow ───────────────────────────────────────────────────

describe('buildMonthlyCashFlow', () => {
  it('returns zero flow for empty input', () => {
    const flow = buildMonthlyCashFlow(emptyInput, JUNE)
    expect(flow.income).toBe(0)
    expect(flow.outflow).toBe(0)
    expect(flow.netFlow).toBe(0)
  })

  it('includes current salary in income', () => {
    const flow = buildMonthlyCashFlow(
      { ...emptyInput, salaryHistory: [salary({ amount: 75000, effective_date: '2026-01-01' })] },
      JUNE,
    )
    expect(flow.income).toBe(75000)
    expect(flow.salaryIncome).toBe(75000)
  })

  it('uses the salary effective for the requested month', () => {
    const salaryHistory = [salary({ amount: 90000, effective_date: '2026-07-01' })]

    expect(buildMonthlyCashFlow({ ...emptyInput, salaryHistory }, JUNE).salaryIncome).toBe(0)
    expect(buildMonthlyCashFlow({ ...emptyInput, salaryHistory }, new Date(2026, 6, 1)).salaryIncome).toBe(90000)
  })

  it('includes due receivables in income', () => {
    const flow = buildMonthlyCashFlow(
      {
        ...emptyInput,
        debts: [
          debt({ direction: 'borç_verdim', estimated_value_try: 5000, due_date: '2026-06-20', status: 'açık' }),
          debt({ direction: 'borç_verdim', estimated_value_try: 999, due_date: '2026-07-01', status: 'açık' }), // next month
        ],
      },
      JUNE,
    )
    expect(flow.receivableIncome).toBe(5000)
    expect(flow.income).toBe(5000)
  })

  it('counts pending payments in outflow', () => {
    const flow = buildMonthlyCashFlow(
      {
        ...emptyInput,
        payments: [payment({ amount: 1200, due_date: '2026-06-10', status: 'bekliyor' })],
      },
      JUNE,
    )
    expect(flow.paymentOutflow).toBe(1200)
    expect(flow.outflow).toBeGreaterThanOrEqual(1200)
  })

  it('does not count credit-card automatic payments as immediate cash outflow', () => {
    const flow = buildMonthlyCashFlow(
      {
        ...emptyInput,
        payments: [
          payment({ amount: 1200, due_date: '2026-06-10', payment_method: 'bank_auto', auto_source_card_id: 'credit-card' }),
          payment({ amount: 300, due_date: '2026-06-12', payment_method: 'manual' }),
        ],
      },
      JUNE,
    )
    expect(flow.paymentOutflow).toBe(300)
  })

  it('includes scheduled loan installments in outflow', () => {
    const l = loan({ id: 'l1', status: 'active', monthly_payment: 3000, remaining_installments: 10, installment_day: 10 })
    const li = loanInstallment({ loan_id: 'l1', due_date: '2026-06-10', amount: 3000, status: 'bekliyor' })
    const flow = buildMonthlyCashFlow({ ...emptyInput, loans: [l], loanInstallments: [li] }, JUNE)
    expect(flow.loanOutflow).toBe(3000)
  })

  it('uses legacy loan model when no installments exist', () => {
    const l = loan({ id: 'l2', status: 'active', monthly_payment: 2500, remaining_installments: 5, installment_day: 10 })
    const flow = buildMonthlyCashFlow({ ...emptyInput, loans: [l], loanInstallments: [] }, JUNE)
    // No installments → legacy path picks up monthly_payment for the due day in June
    expect(flow.loanOutflow).toBe(2500)
  })

  it('projectedCash = cashAssets + netFlow', () => {
    const flow = buildMonthlyCashFlow(
      {
        ...emptyInput,
        assets: [asset({ category: 'Nakit', estimated_value_try: 20000 })],
        salaryHistory: [salary({ amount: 10000, effective_date: '2026-01-01' })],
        payments: [payment({ amount: 3000, due_date: '2026-06-15', status: 'bekliyor' })],
      },
      JUNE,
    )
    expect(flow.projectedCash).toBeCloseTo(flow.cashAssets + flow.netFlow)
  })

  it('keeps projected cash exact at kurus precision', () => {
    const flow = buildMonthlyCashFlow(
      {
        ...emptyInput,
        assets: [asset({ category: 'Nakit', estimated_value_try: 0.1 })],
        salaryHistory: [salary({ amount: 0.2, effective_date: '2026-01-01' })],
        payments: [payment({ amount: 0.1, due_date: '2026-06-15', status: 'bekliyor' })],
      },
      JUNE,
    )

    expect(flow.income).toBe(0.2)
    expect(flow.outflow).toBe(0.1)
    expect(flow.netFlow).toBe(0.1)
    expect(flow.projectedCash).toBe(0.2)
  })
})

// ── buildGoalProgressSummary ───────────────────────────────────────────────

describe('buildGoalProgressSummary', () => {
  it('returns zero counts for no active goals', () => {
    const result = buildGoalProgressSummary([], [])
    expect(result.activeCount).toBe(0)
    expect(result.averageProgress).toBe(0)
    expect(result.nextGoalName).toBeNull()
  })

  it('counts only active goals', () => {
    const result = buildGoalProgressSummary([
      goal({ id: 'g1', status: 'active', target_amount: 100, current_amount: 50 }),
      goal({ id: 'g2', status: 'completed', target_amount: 100, current_amount: 100 }),
    ])
    expect(result.activeCount).toBe(1)
  })

  it('picks the soonest upcoming goal as next', () => {
    const result = buildGoalProgressSummary([
      goal({ id: 'g1', name: 'Araba', target_date: '2027-01-01', target_amount: 100, current_amount: 10, status: 'active' }),
      goal({ id: 'g2', name: 'Tatil', target_date: '2026-09-01', target_amount: 50, current_amount: 10, status: 'active' }),
    ])
    expect(result.nextGoalName).toBe('Tatil')
  })
})

// ── buildFinancialHealth ───────────────────────────────────────────────────

describe('buildFinancialHealth', () => {
  function healthInput(overrides: Partial<Parameters<typeof buildFinancialHealth>[0]> = {}) {
    const defaults = {
      position: buildFinancialPosition(emptyInput),
      cashFlow: buildMonthlyCashFlow(emptyInput, JUNE),
      creditUsageRate: 0,
      urgentUpcomingCount: 0,
      averageGoalProgress: 0,
    }
    return { ...defaults, ...overrides }
  }

  it('returns emerald / Dengeli for healthy financials', () => {
    const position = buildFinancialPosition({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 200000 })],
    })
    const cashFlow = buildMonthlyCashFlow({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 200000 })],
      salaryHistory: [salary({ amount: 50000, effective_date: '2026-01-01' })],
      payments: [payment({ amount: 5000, due_date: '2026-06-15', status: 'bekliyor' })],
    }, JUNE)
    const result = buildFinancialHealth({ position, cashFlow, creditUsageRate: 10, urgentUpcomingCount: 0, averageGoalProgress: 70 })
    expect(result.tone).toBe('emerald')
    expect(result.label).toBe('Dengeli')
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('returns rose / Riskli when debts exceed assets', () => {
    const position = buildFinancialPosition({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 1000 })],
      cards: [creditCard({ debt_amount: 50000, statement_debt_amount: 50000 })],
    })
    const result = buildFinancialHealth(healthInput({ position, creditUsageRate: 90, urgentUpcomingCount: 5 }))
    expect(result.tone).toBe('rose')
    expect(result.label).toBe('Riskli')
    expect(result.score).toBeLessThan(60)
  })

  it('returns amber for moderate risk', () => {
    // Create moderate conditions: manageable debt, ok credit usage
    const position = buildFinancialPosition({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 100000 })],
      cards: [creditCard({ debt_amount: 40000, statement_debt_amount: 40000 })],
    })
    const cashFlow = buildMonthlyCashFlow({
      ...emptyInput,
      assets: [asset({ category: 'Nakit', estimated_value_try: 100000 })],
      salaryHistory: [salary({ amount: 20000, effective_date: '2026-01-01' })],
      payments: [payment({ amount: 16000, due_date: '2026-06-15', status: 'bekliyor' })],
    }, JUNE)
    const result = buildFinancialHealth({ position, cashFlow, creditUsageRate: 60, urgentUpcomingCount: 1, averageGoalProgress: 0 })
    expect(result.score).toBeGreaterThanOrEqual(60)
    expect(result.score).toBeLessThan(80)
    expect(result.tone).toBe('amber')
  })

  it('clamps score to [0, 100]', () => {
    const result = buildFinancialHealth(healthInput({
      position: buildFinancialPosition({
        ...emptyInput,
        assets: [asset({ category: 'Nakit', estimated_value_try: 5 })],
        cards: [creditCard({ debt_amount: 9999999, statement_debt_amount: 9999999 })],
      }),
      creditUsageRate: 100,
      urgentUpcomingCount: 10,
    }))
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('includes up to 5 factors', () => {
    const result = buildFinancialHealth(healthInput())
    expect(result.factors.length).toBeLessThanOrEqual(5)
    expect(result.factors.length).toBeGreaterThan(0)
  })
})
