import { describe, it, expect } from 'vitest'
import { buildHealthCounts } from './dataHealthSummary'
import type { Card, CardInstallment, Loan, LoanInstallment } from '../types/database'

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    user_id: 'u1',
    card_type: 'kredi_karti',
    bank_name: 'Test',
    card_name: 'Kart',
    credit_limit: 10000,
    debt_amount: 500,
    statement_debt_amount: 300,
    current_period_spending: 200,
    provision_amount: 0,
    statement_closing_day: 15,
    payment_due_day: 5,
    limit_group_name: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    current_balance: 0,
    ...overrides,
  } as Card
}

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 'l1',
    user_id: 'u1',
    bank_name: 'Test',
    loan_name: 'Kredi',
    total_amount: 10000,
    remaining_amount: 5000,
    monthly_payment: 1000,
    interest_rate: 2,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
    status: 'active',
    remaining_installments: 5,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as Loan
}

function makeLoanInstallment(overrides: Partial<LoanInstallment> = {}): LoanInstallment {
  return {
    id: 'li1',
    loan_id: 'l1',
    user_id: 'u1',
    installment_no: 1,
    amount: 1000,
    due_date: '2026-02-01',
    status: 'bekliyor',
    paid_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as LoanInstallment
}

function makeCardInstallment(overrides: Partial<CardInstallment> = {}): CardInstallment {
  return {
    id: 'ci1',
    user_id: 'u1',
    card_id: 'c1',
    card_expense_id: null,
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 1,
    due_month: '2026-02-01',
    amount: 250,
    description: 'Taksit',
    category: 'Genel',
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    note: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  } as CardInstallment
}

const emptyInput = {
  cards: [],
  cardExpenses: [],
  cardInstallments: [],
  loans: [],
  loanInstallments: [],
}

describe('buildHealthCounts', () => {
  it('returns zero counts for empty data', () => {
    const result = buildHealthCounts(emptyInput)
    expect(result).toEqual({ errors: 0, warnings: 0, total: 0, checksRun: 0, cleanChecks: 0 })
  })

  it('returns zero when card debt split is consistent', () => {
    const card = makeCard({ debt_amount: 500, statement_debt_amount: 300, current_period_spending: 200, provision_amount: 0 })
    const result = buildHealthCounts({ ...emptyInput, cards: [card] })
    expect(result.errors).toBe(0)
  })

  it('detects card debt split overflow as error', () => {
    const card = makeCard({ debt_amount: 100, statement_debt_amount: 300, current_period_spending: 200, provision_amount: 0 })
    const result = buildHealthCounts({ ...emptyInput, cards: [card] })
    expect(result.errors).toBeGreaterThanOrEqual(1)
  })

  it('detects scheduled installment debt missing from card debt as error', () => {
    const card = makeCard({ debt_amount: 500, statement_debt_amount: 300, current_period_spending: 200, provision_amount: 0 })
    const result = buildHealthCounts({
      ...emptyInput,
      cards: [card],
      cardInstallments: [makeCardInstallment({ amount: 250 })],
    })
    expect(result.errors).toBeGreaterThanOrEqual(1)
  })

  it('detects loan remaining mismatch as error', () => {
    const loan = makeLoan({ remaining_amount: 9999, remaining_installments: 3 })
    const installments = [
      makeLoanInstallment({ id: 'li1', amount: 1000, status: 'bekliyor' }),
      makeLoanInstallment({ id: 'li2', amount: 1000, status: 'bekliyor', installment_no: 2 }),
      makeLoanInstallment({ id: 'li3', amount: 1000, status: 'bekliyor', installment_no: 3 }),
    ]
    const result = buildHealthCounts({ ...emptyInput, loans: [loan], loanInstallments: installments })
    expect(result.errors).toBeGreaterThanOrEqual(1)
  })

  it('returns zero when loan totals match', () => {
    const loan = makeLoan({ remaining_amount: 3000, remaining_installments: 3 })
    const installments = [
      makeLoanInstallment({ id: 'li1', amount: 1000, status: 'bekliyor' }),
      makeLoanInstallment({ id: 'li2', amount: 1000, status: 'bekliyor', installment_no: 2 }),
      makeLoanInstallment({ id: 'li3', amount: 1000, status: 'bekliyor', installment_no: 3 }),
    ]
    const result = buildHealthCounts({ ...emptyInput, loans: [loan], loanInstallments: installments })
    expect(result.errors).toBe(0)
  })

  it('detects credit limit exceeded as warning', () => {
    const card = makeCard({ debt_amount: 11000, statement_debt_amount: 11000, current_period_spending: 0, credit_limit: 10000 })
    const result = buildHealthCounts({ ...emptyInput, cards: [card] })
    expect(result.warnings).toBeGreaterThanOrEqual(1)
  })

  it('detects a shared limit exceeded by the combined group debt', () => {
    const first = makeCard({ id: 'c1', limit_group_name: 'Ortak', debt_amount: 12000, statement_debt_amount: 12000, credit_limit: 20000 })
    const second = makeCard({ id: 'c2', limit_group_name: 'Ortak', debt_amount: 12000, statement_debt_amount: 12000, credit_limit: 20000 })
    const result = buildHealthCounts({ ...emptyInput, cards: [first, second] })
    expect(result.warnings).toBeGreaterThanOrEqual(1)
  })
})

describe('checksRun / cleanChecks', () => {
  it('boş veride hiç kontrol koşmaz', () => {
    const result = buildHealthCounts(emptyInput)
    expect(result.checksRun).toBe(0)
    expect(result.cleanChecks).toBe(0)
    expect(result.total).toBe(0)
  })

  it('her kredi kartı üç kontrol koşturur', () => {
    const result = buildHealthCounts({ ...emptyInput, cards: [makeCard({ id: 'c1' }), makeCard({ id: 'c2' })] })
    // 2 kart x 3 kontrol + 2 tekil limit grubu
    expect(result.checksRun).toBe(8)
  })

  it('banka kartı kontrol sayacına girmez', () => {
    const bank = makeCard({ id: 'b1', card_type: 'banka_karti', credit_limit: 0, debt_amount: 0, statement_debt_amount: 0 })
    const result = buildHealthCounts({ ...emptyInput, cards: [bank] })
    expect(result.checksRun).toBe(0)
  })

  it('ödeme planı olmayan kredi "temiz geçti" diye sayılmaz', () => {
    const result = buildHealthCounts({ ...emptyInput, loans: [makeLoan()] })
    expect(result.checksRun).toBe(0)
    expect(result.cleanChecks).toBe(0)
  })

  it('planı olan kredi iki kontrol koşturur', () => {
    const loan = makeLoan({ remaining_amount: 3000, remaining_installments: 3 })
    const installments = [
      makeLoanInstallment({ id: 'li1', amount: 1000, status: 'bekliyor' }),
      makeLoanInstallment({ id: 'li2', amount: 1000, status: 'bekliyor', installment_no: 2 }),
      makeLoanInstallment({ id: 'li3', amount: 1000, status: 'bekliyor', installment_no: 3 }),
    ]
    const result = buildHealthCounts({ ...emptyInput, loans: [loan], loanInstallments: installments })
    expect(result.checksRun).toBe(2)
    expect(result.cleanChecks).toBe(2)
  })

  it('cleanChecks = checksRun − bulgu; bulgulu kartta düşer', () => {
    const bad = makeCard({ debt_amount: 100, statement_debt_amount: 900, current_period_spending: 900, credit_limit: 10000 })
    const result = buildHealthCounts({ ...emptyInput, cards: [bad] })
    expect(result.checksRun).toBe(4) // 3 kart kontrolü + 1 limit grubu
    expect(result.cleanChecks).toBe(result.checksRun - result.total)
    expect(result.cleanChecks).toBeGreaterThanOrEqual(0)
  })

  it('limitsiz grup aşım kontrolüne girmez', () => {
    const noLimit = makeCard({ credit_limit: 0, debt_amount: 0, statement_debt_amount: 0, current_period_spending: 0 })
    const result = buildHealthCounts({ ...emptyInput, cards: [noLimit] })
    expect(result.checksRun).toBe(3)
  })
})
