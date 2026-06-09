import type { Card } from '../types/database'
import { getNextCardPaymentDueDate } from './cardStatement'
import { addMonths, dateInputValue, isDateInMonth, startOfMonth } from './date'
import {
  buildFinancialPosition,
  getCurrentSalary,
  paymentCashOutflowAmount,
  paymentOccurrenceInMonth,
  roundMoney,
  sum,
  type FinanceSummaryInput,
} from './financeSummary'

/**
 * Forward-looking cash-flow projection.
 *
 * Chains a running liquid balance over the next N months so the user can see
 * the lowest point and the first month that goes negative *before* it happens.
 * It complements `buildMonthlyCashFlow`, which only describes a single month.
 *
 * Credit-card debt uses the "known data" model (Option A): the current
 * statement debt is counted once on its next due date and the current period's
 * spending once on the following cycle's due date — never repeated month after
 * month. Future card spending that hasn't been entered is intentionally absent,
 * so the projection reflects committed obligations rather than guesses.
 */

export type CashFlowForecastMonth = {
  monthKey: string
  monthLabel: string
  income: number
  outflow: number
  net: number
  endingBalance: number
  salary: number
  receivables: number
  paymentOutflow: number
  cardOutflow: number
  loanOutflow: number
  installmentOutflow: number
  debtOutflow: number
}

export type CashFlowForecastMarker = {
  monthKey: string
  monthLabel: string
  balance: number
}

export type CashFlowForecast = {
  startingBalance: number
  endingBalance: number
  months: CashFlowForecastMonth[]
  lowest: CashFlowForecastMarker | null
  firstNegative: CashFlowForecastMarker | null
}

const MONTH_LABEL = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })

function monthKeyOf(date: Date) {
  return dateInputValue(startOfMonth(date))
}

/**
 * Map each credit card's already-known debt to the month it actually falls due,
 * counted once. Statement debt lands on the next due date; the open period's
 * spending lands on the following cycle's due date (when it will be billed).
 */
function cardOutflowByMonth(cards: Card[], from: Date): Map<string, number> {
  const byMonth = new Map<string, number>()
  const add = (key: string, amount: number) => {
    if (amount > 0) byMonth.set(key, (byMonth.get(key) ?? 0) + amount)
  }

  for (const card of cards) {
    if (card.card_type !== 'kredi_karti' || !card.due_day) continue
    const nextDue = getNextCardPaymentDueDate(card, from)
    if (!nextDue) continue
    const nextDueDate = new Date(`${nextDue}T00:00:00`)
    add(monthKeyOf(nextDueDate), card.statement_debt_amount)
    add(monthKeyOf(addMonths(nextDueDate, 1)), card.current_period_spending)
  }

  return byMonth
}

export function buildCashFlowForecast(
  data: FinanceSummaryInput,
  options: { horizonMonths?: number; from?: Date } = {},
): CashFlowForecast {
  const horizonMonths = Math.max(0, options.horizonMonths ?? 6)
  const from = options.from ?? new Date()
  const firstMonth = startOfMonth(from)

  const startingBalance = roundMoney(buildFinancialPosition(data).totalCashAssets)
  const salary = roundMoney(getCurrentSalary(data.salaryHistory)?.amount ?? 0)
  const cardByMonth = cardOutflowByMonth(data.cards, from)
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
  const openDebts = data.debts.filter((debt) => debt.status === 'açık')

  const months: CashFlowForecastMonth[] = []
  let runningBalance = startingBalance
  let lowest: CashFlowForecastMarker | null = null
  let firstNegative: CashFlowForecastMarker | null = null

  for (let offset = 0; offset < horizonMonths; offset += 1) {
    const monthDate = addMonths(firstMonth, offset)
    const monthKey = monthKeyOf(monthDate)
    const monthLabel = MONTH_LABEL.format(monthDate)

    const receivables = roundMoney(
      sum(
        openDebts.filter((debt) => debt.direction === 'borç_verdim' && isDateInMonth(debt.due_date, monthDate)),
        (debt) => debt.estimated_value_try,
      ),
    )
    const paymentOutflow = roundMoney(
      sum(
        data.payments.filter((payment) => paymentOccurrenceInMonth(payment, monthDate)),
        paymentCashOutflowAmount,
      ),
    )
    const scheduledLoanOutflow = sum(
      data.loanInstallments.filter((installment) => installment.status === 'bekliyor' && isDateInMonth(installment.due_date, monthDate)),
      (installment) => installment.amount,
    )
    const legacyLoanOutflow = sum(
      data.loans.filter(
        (loan) =>
          !plannedLoanIds.has(loan.id) &&
          loan.status === 'active' &&
          loan.installment_day !== null &&
          offset < loan.remaining_installments,
      ),
      (loan) => loan.monthly_payment,
    )
    const loanOutflow = roundMoney(scheduledLoanOutflow + legacyLoanOutflow)
    const installmentOutflow = roundMoney(
      sum(
        data.cardInstallments.filter((installment) => installment.status === 'scheduled' && installment.due_month === monthKey),
        (installment) => installment.amount,
      ),
    )
    const cardOutflow = roundMoney(cardByMonth.get(monthKey) ?? 0)
    const debtOutflow = roundMoney(
      sum(
        openDebts.filter((debt) => debt.direction === 'borç_aldım' && isDateInMonth(debt.due_date, monthDate)),
        (debt) => debt.estimated_value_try,
      ),
    )

    const income = roundMoney(salary + receivables)
    const outflow = roundMoney(paymentOutflow + cardOutflow + loanOutflow + installmentOutflow + debtOutflow)
    const net = roundMoney(income - outflow)
    runningBalance = roundMoney(runningBalance + net)

    months.push({
      monthKey,
      monthLabel,
      income,
      outflow,
      net,
      endingBalance: runningBalance,
      salary,
      receivables,
      paymentOutflow,
      cardOutflow,
      loanOutflow,
      installmentOutflow,
      debtOutflow,
    })

    if (!lowest || runningBalance < lowest.balance) {
      lowest = { monthKey, monthLabel, balance: runningBalance }
    }
    if (!firstNegative && runningBalance < 0) {
      firstNegative = { monthKey, monthLabel, balance: runningBalance }
    }
  }

  return { startingBalance, endingBalance: runningBalance, months, lowest, firstNegative }
}
