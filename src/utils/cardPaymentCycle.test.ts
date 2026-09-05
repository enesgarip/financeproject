import { describe, expect, it } from 'vitest'
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
} from '../types/database'
import { buildCashFlowForecast } from './cashFlowForecast'
import type { FinanceSummaryInput } from './financeSummary'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }
const FROM = new Date(2026, 5, 5) // 1 June 2026

function asset(overrides: Partial<Asset>): Asset {
  return { ...base, name: 'Varlık', category: 'Nakit', amount: 0, unit: 'TRY', currency: 'TRY', symbol: null, unit_cost: null, estimated_value_try: 0, auto_valued: false, valued_at: null, valuation_rate: null, source: null, note: null, ...overrides }
}

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

function loan(overrides: Partial<Loan>): Loan {
  return { ...base, bank_name: 'Banka', loan_name: 'Kredi', total_amount: 0, remaining_amount: 0, monthly_payment: 0, installment_day: null, start_date: null, end_date: null, remaining_installments: 0, status: 'active', note: null, ...overrides }
}

function loanInstallment(overrides: Partial<LoanInstallment>): LoanInstallment {
  return { ...base, loan_id: 'L', installment_no: 1, due_date: '2026-06-01', amount: 0, status: 'bekliyor', paid_at: null, note: null, ...overrides }
}

function debt(overrides: Partial<Debt>): Debt {
  return { ...base, person_name: 'Kişi', direction: 'borç_aldım', value_type: 'TRY', currency: null, amount: 0, estimated_value_try: 0, auto_valued: false, valued_at: null, valuation_rate: null, due_date: null, status: 'açık', note: null, ...overrides }
}

function payment(overrides: Partial<Payment>): Payment {
  return { ...base, title: 'Ödeme', category: 'Fatura', amount: 0, amount_status: 'exact', due_date: '2026-06-01', status: 'bekliyor', payment_method: 'manual', recurrence: 'none', recurrence_day: null, recurrence_end_date: null, auto_source_card_id: null, note: null, ...overrides }
}

function salary(overrides: Partial<SalaryHistory>): SalaryHistory {
  return { ...base, title: 'Maaş', amount: 0, effective_date: '2026-01-01', note: null, ...overrides }
}

function cardInstallment(overrides: Partial<CardInstallment>): CardInstallment {
  return { ...base, card_id: 'c', card_expense_id: null, statement_archive_id: null, installment_no: 1, installment_count: 1, due_month: '2026-06-01', amount: 0, description: 'Taksit', category: 'Diğer', status: 'scheduled', posted_at: null, paid_at: null, note: null, ...overrides }
}

function statement(overrides: Partial<CardStatementArchive>): CardStatementArchive {
  return {
    ...base,
    card_id: 'cc',
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

function buildInput(overrides: Partial<FinanceSummaryInput> = {}): FinanceSummaryInput {
  return { assets: [], cards: [], loans: [], loanInstallments: [], debts: [], payments: [], salaryHistory: [], cardInstallments: [], ...overrides }
}


import { buildCardPaymentCycle, buildCardCycleForecast, cardSpendingScenario } from './cardPaymentCycle'

const options = { from: FROM, buffer: 0, reserved: 0 }
describe('card payment cycle', () => {
  it('allocates one pool to two statements and deducts partial payments', () => {
    const input = buildInput({ assets: [asset({ estimated_value_try: 100 })], cards: [card({ id: 'a', card_type: 'kredi_karti' }), card({ id: 'b', card_type: 'kredi_karti' })], cardStatements: [statement({ id: 's1', card_id: 'a', statement_debt_amount: 100 }), statement({ id: 's2', card_id: 'b', statement_debt_amount: 60, due_date: '2026-06-11' })], cardStatementPayments: [{ statement_archive_id: 's1', amount: 20 }] })
    const result = buildCardPaymentCycle(input, options)
    expect(result.statements.map(r => [r.amount, r.readyNow, r.gapByDue])).toEqual([[80,80,0],[60,20,40]])
  })
  it('reserves earlier cash bills and buffer, but not card-settled installments', () => {
    const input = buildInput({ assets: [asset({ estimated_value_try: 200 })], cards: [card({ id: 'cc', card_type: 'kredi_karti' })], cardStatements: [statement({ statement_debt_amount: 100 })], payments: [payment({ amount: 50, due_date: '2026-06-06' })], cardInstallments: [cardInstallment({ amount: 100, due_month: '2026-06-07' })] })
    expect(buildCardPaymentCycle(input, { ...options, buffer: 40, reserved: 30 }).statements[0].readyNow).toBe(80)
  })
  it('does not count past salary and counts future salary only after its date', () => {
    const input = buildInput({ cards: [card({ id: 'cc', card_type: 'kredi_karti' })], salaryHistory: [salary({ amount: 100 })], cardStatements: [statement({ id: 'a', statement_debt_amount: 50, due_date: '2026-06-30' }), statement({ id: 'b', statement_debt_amount: 50, due_date: '2026-07-02' })] })
    expect(buildCardPaymentCycle(input, options).statements.map(r => [r.readyNow, r.gapByDue])).toEqual([[0,50],[0,0]])
    input.cardStatements![1].due_date = '2026-07-01'
    expect(buildCardPaymentCycle(input, options).statements[1].gapByDue).toBe(50)
  })
  it('includes overdue loans and undated debt without repeating old recurring bills', () => {
    const input = buildInput({ assets: [asset({ estimated_value_try: 250 })], cards: [card({ id: 'cc', card_type: 'kredi_karti' })], cardStatements: [statement({ statement_debt_amount: 200 })], loans: [loan({id:'L'})], loanInstallments: [loanInstallment({ amount: 30, due_date: '2026-04-02' })], debts: [debt({ estimated_value_try: 20 })], payments: [payment({ amount: 40, recurrence: 'monthly', recurrence_day: 1, due_date: '2026-05-01' })] })
    expect(buildCardPaymentCycle(input, options).statements[0].readyNow).toBe(160)
  })
  it('payment preserves cash minus card debt; new purchases reduce it', () => {
    const input = buildInput({ assets: [asset({ estimated_value_try: 100 })], cards: [card({card_type:'kredi_karti', debt_amount:70})] })
    expect(buildCardPaymentCycle(input, options).cashMinusDebt).toBe(30)
    input.assets[0].estimated_value_try=60;input.cards[0].debt_amount=30
    expect(buildCardPaymentCycle(input, options).cashMinusDebt).toBe(30)
    input.cards[0].debt_amount=35
    expect(buildCardPaymentCycle(input, options).cashMinusDebt).toBe(25)
  })
  it('keeps unknown dates explicit and current period separate from statements', () => {
    const input = buildInput({ cards: [card({ id:'cc',card_type:'kredi_karti',statement_debt_amount:20,current_period_spending:30 })] })
    const result=buildCardPaymentCycle(input,options)
    expect(result.statements[0]).toMatchObject({ amount:20, due:null, estimatedDate:true })
    expect(result.next[0].projection).toBeUndefined()
  })
  it('places extra spending next month without modifying baseline', () => {
    const forecast=buildCashFlowForecast(buildInput({assets:[asset({estimated_value_try:100})]}), {from:FROM,horizonMonths:3})
    expect(cardSpendingScenario(forecast,20,10).map(r=>r.scenario)).toEqual([90,70,50])
    expect(forecast.endingBalance).toBe(100)
    expect(cardSpendingScenario(forecast,NaN,10).map(r=>r.scenario)).toEqual([90,90,90])
  })
})

it('adds scheduled installments at the bill date without adding current spending twice', () => {
  const input = buildInput({ assets:[asset({estimated_value_try:1000})], cards:[card({id:'cc',card_type:'kredi_karti',statement_day:20,due_day:30,current_period_spending:100,debt_amount:160})],cardInstallments:[cardInstallment({card_id:'cc',amount:60,due_month:'2026-07-01'})] })
  const basic=buildCashFlowForecast(input,{from:FROM})
  const cycle=buildCardCycleForecast(input,FROM)
  expect(cycle.months[0].endingBalance).toBe(basic.months[0].endingBalance)
  expect(cycle.months[1].endingBalance).toBe(basic.months[1].endingBalance-60)
  expect(cycle.months[2].endingBalance).toBe(basic.months[2].endingBalance-60)
})
it('honors the end date of a card payment plan in the scenario', () => {
  const input=buildInput({cards:[card({id:'cc',card_type:'kredi_karti',statement_day:20,due_day:30})],payments:[payment({amount:20,payment_method:'bank_auto',auto_source_card_id:'cc',due_date:'2026-06-10',recurrence:'monthly',recurrence_day:10,recurrence_end_date:'2026-06-30'})]})
  expect(buildCardCycleForecast(input,FROM).months.map(r=>r.cardOutflow)).toEqual([20,0,0,0,0,0])
})

import { buildDashboardUpcomingItems, groupDashboardInstallments } from './dashboardUpcoming'
it('groups only same-card same-day informational installments and preserves cash totals', () => {
  const input={...buildInput({cardInstallments:[cardInstallment({id:'1',card_id:'cc',amount:10,due_month:'2026-06-06'}),cardInstallment({id:'2',card_id:'cc',amount:20,due_month:'2026-06-06'}),cardInstallment({id:'3',card_id:'other',amount:30,due_month:'2026-06-06'})],payments:[payment({id:'p',amount:50,due_date:'2026-06-06'})]}),cardStatements:[]}
  const grouped=groupDashboardInstallments(buildDashboardUpcomingItems(input,30,FROM))
  expect(grouped).toHaveLength(3)
  expect(grouped.find(r=>r.children)?.amount).toBe(30)
  expect(grouped.find(r=>r.children)?.cashImpactAmount).toBe(0)
  expect(grouped.find(r=>r.kind==='payment')?.obligation.action).toBe('pay_payment')
})
