import { getCardStatementPeriod, getNextCardPaymentDueDate } from './cardStatement'
import { buildStatementPaidMap, openStatementsWithRemaining, statementRemainingAmount } from './cardStatementPayments'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { buildFinancialPosition, type FinanceSummaryInput } from './financeSummary'
import { buildFinanceObligationsForMonth } from './obligations'
import { diffTL, sumTL } from './money'
import { projectUpcomingStatements } from './statementProjection'
import { buildCashFlowForecast, type CashFlowForecast } from './cashFlowForecast'

/** Read-only, shared cash pool. Expected income is never classified as cash ready today. */
export function buildCardPaymentCycle(data: FinanceSummaryInput, options: { from: Date; buffer: number; reserved: number }) {
  const today = dateInputValue(options.from)
  const position = buildFinancialPosition(data)
  const cards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  const paid = buildStatementPaidMap(data.cardStatementPayments ?? [])
  const archives = openStatementsWithRemaining(data.cardStatements ?? [], paid)
  const statements = cards.flatMap((card) => {
    const rows = archives.filter((row) => row.card_id === card.id)
    return rows.length ? rows.map((row) => ({ id: row.id, cardId: card.id, name: card.card_name, due: row.due_date, amount: statementRemainingAmount(row, paid), estimatedDate: false }))
      : card.statement_debt_amount > 0 ? [{ id: card.id, cardId: card.id, name: card.card_name, due: getNextCardPaymentDueDate(card, options.from), amount: card.statement_debt_amount, estimatedDate: true }] : []
  }).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || a.id.localeCompare(b.id))
  const lastDue = statements.reduce((last, row) => row.due && row.due > last ? row.due : last, today)
  // Include explicit overdue records, but do not manufacture missed recurring months.
  const sourceDates = [today, ...data.payments.map((r) => r.due_date), ...data.loanInstallments.map((r) => r.due_date), ...data.debts.map((r) => r.due_date)].filter((date): date is string => Boolean(date))
  const months = new Set(sourceDates.filter((date) => date <= lastDue).map((date) => date.slice(0, 7)))
  for (let cursor = startOfMonth(options.from); dateInputValue(cursor) <= lastDue; cursor = addMonths(cursor, 1)) months.add(dateInputValue(cursor).slice(0, 7))
  const obligations = [...months].flatMap((month) => buildFinanceObligationsForMonth({ ...data, cardStatements: data.cardStatements ?? [] }, new Date(month + '-01T00:00:00'), { from: options.from }))
    .filter((item) => item.date <= lastDue)
    .filter((item) => item.kind !== 'card_statement' && !(item.kind === 'card_debt' && item.action === 'pay_card_debt'))
    .filter((item) => item.date >= today || (item.direction === 'outflow' && item.kind !== 'legacy_loan_installment' && (item.kind !== 'payment' || data.payments.some((p) => p.id === item.sourceId && p.due_date === item.date))))
  const undatedDebt = sumTL(data.debts.filter((r) => r.status === 'açık' && r.direction === 'borç_aldım' && !r.due_date).map((r) => r.estimated_value_try))
  const held = sumTL([options.buffer, options.reserved, undatedDebt])
  let now = diffTL(position.totalCashAssets, held)
  let projected = now
  const events = [
    ...statements.map((row) => ({ date: row.due ?? today, statement: row, amount: row.amount, inflow: false })),
    ...obligations.map((item) => ({ date: item.date, statement: null, amount: item.cashImpactAmount ?? item.amount, inflow: item.direction === 'inflow' })),
  ].sort((a, b) => a.date.localeCompare(b.date) || Number(a.inflow) - Number(b.inflow) || Number(Boolean(a.statement)) - Number(Boolean(b.statement)))
  const readiness = []
  for (const event of events) {
    if (event.inflow) {
      // Same-day salary/collection may already be in bank balance. Never add it again.
      if (event.date > today) projected = sumTL([projected, event.amount])
      continue
    }
    if (event.statement) readiness.push({ ...event.statement, readyNow: Math.min(event.amount, Math.max(0, now)), gapByDue: Math.max(0, diffTL(event.amount, Math.max(0, projected))) })
    now = diffTL(now, event.amount)
    projected = diffTL(projected, event.amount)
  }
  return {
    statements: readiness,
    cash: position.totalCashAssets,
    held,
    cardDebt: position.totalCreditCardDebt,
    cashMinusDebt: diffTL(position.totalCashAssets, position.totalCreditCardDebt),
    next: cards.map((card) => ({ id: card.id, name: card.card_name, provision: card.provision_amount ?? 0, projection: projectUpcomingStatements(card, data.cardInstallments, [], data.payments, options.from, 1)[0] })),
  }
}

/** Scenario-only supplement: scheduled card loads become cash at their statement due date. */
export function buildCardCycleForecast(data: FinanceSummaryInput, from: Date): CashFlowForecast {
  const forecast = buildCashFlowForecast(data, { from })
  const futureBills: { date: string; amount: number }[] = []
  for (const card of data.cards.filter((row) => row.card_type === 'kredi_karti')) {
    for (const period of projectUpcomingStatements(card, data.cardInstallments, [], [], from, 7)) {
      futureBills.push({ date: period.dueDate, amount: period.installmentTotal })
    }
  }
  for (const month of forecast.months) {
    const obligations = buildFinanceObligationsForMonth({ ...data, cardStatements: data.cardStatements ?? [] }, new Date(`${month.monthKey}T00:00:00`), { from })
    for (const item of obligations) {
      if (item.kind !== 'payment' || item.settlement !== 'credit_card' || item.date < dateInputValue(from)) continue
      const card = data.cards.find((row) => row.id === item.relatedCardId)
      const period = card && getCardStatementPeriod(card, new Date(`${item.date}T00:00:00`))
      if (period) futureBills.push({ date: period.dueDate, amount: item.amount })
    }
  }
  let running = forecast.startingBalance
  const months = forecast.months.map((month) => {
    const extra = sumTL(futureBills.filter((bill) => bill.date.slice(0, 7) === month.monthKey.slice(0, 7)).map((bill) => bill.amount))
    running = sumTL([running, month.net, -extra])
    return { ...month, cardOutflow: sumTL([month.cardOutflow, extra]), outflow: sumTL([month.outflow, extra]), net: diffTL(month.net, extra), endingBalance: running }
  })
  const low = months.reduce<typeof months[number] | null>((lowest, month) => !lowest || month.endingBalance < lowest.endingBalance ? month : lowest, null)
  const negative = months.find((month) => month.endingBalance < 0)
  const marker = (month: typeof months[number]) => ({ monthKey: month.monthKey, monthLabel: month.monthLabel, balance: month.endingBalance })
  return { ...forecast, months, endingBalance: running, lowest: low ? marker(low) : null, firstNegative: negative ? marker(negative) : null }
}

/** Extra purchases only: first bill next month; last month's bill falls outside the horizon. */
export function cardSpendingScenario(forecast: CashFlowForecast, monthlyExtra: number, held: number) {
  const extra = Number.isFinite(monthlyExtra) ? Math.max(0, monthlyExtra) : 0
  let accumulated = 0
  return forecast.months.map((month, index) => {
    if (index > 0) accumulated = sumTL([accumulated, extra])
    return { ...month, baseline: diffTL(month.endingBalance, held), scenario: diffTL(diffTL(month.endingBalance, held), accumulated) }
  })
}
