import { addMonths, dateInputValue, startOfMonth } from './date'
import {
  buildFinancialPosition,
  getCurrentSalary,
  type FinanceSummaryInput,
} from './financeSummary'
import { diffTL, roundTL, sumTL } from './money'
import {
  buildFinanceObligationsForMonth,
  type FinanceObligation,
  type FinanceObligationsInput,
} from './obligations'

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

function obligationsInput(data: FinanceSummaryInput): FinanceObligationsInput {
  return {
    cards: data.cards,
    payments: data.payments,
    loans: data.loans,
    loanInstallments: data.loanInstallments,
    debts: data.debts,
    cardInstallments: data.cardInstallments,
    cardStatements: data.cardStatements ?? [],
  }
}

function forecastBuckets(items: FinanceObligation[]) {
  const receivables: number[] = []
  const paymentOutflow: number[] = []
  const cardOutflow: number[] = []
  const loanOutflow: number[] = []
  const installmentOutflow: number[] = []
  const debtOutflow: number[] = []

  for (const item of items) {
    if (item.kind === 'personal_receivable') {
      receivables.push(item.amount)
      continue
    }

    if (item.direction !== 'outflow') continue

    if (item.kind === 'payment') {
      paymentOutflow.push(item.cashImpactAmount ?? item.amount)
    } else if (item.kind === 'card_statement' || item.kind === 'card_debt') {
      cardOutflow.push(item.amount)
    } else if (item.kind === 'card_installment') {
      // Scheduled card installments increase future card debt; they are not a
      // bank-cash movement until a statement/card-debt obligation is paid.
      installmentOutflow.push(item.cashImpactAmount ?? 0)
    } else if (item.kind === 'loan_installment' || item.kind === 'legacy_loan_installment') {
      loanOutflow.push(item.amount)
    } else if (item.kind === 'personal_debt') {
      debtOutflow.push(item.amount)
    }
  }

  return {
    receivables: sumTL(receivables),
    paymentOutflow: sumTL(paymentOutflow),
    cardOutflow: sumTL(cardOutflow),
    loanOutflow: sumTL(loanOutflow),
    installmentOutflow: sumTL(installmentOutflow),
    debtOutflow: sumTL(debtOutflow),
  }
}

export function buildCashFlowForecast(
  data: FinanceSummaryInput,
  options: { horizonMonths?: number; from?: Date } = {},
): CashFlowForecast {
  const horizonMonths = Math.max(0, options.horizonMonths ?? 6)
  const from = options.from ?? new Date()
  const firstMonth = startOfMonth(from)

  const startingBalance = roundTL(buildFinancialPosition(data).totalCashAssets)
  const salary = roundTL(getCurrentSalary(data.salaryHistory)?.amount ?? 0)
  const obligationInput = obligationsInput(data)

  const months: CashFlowForecastMonth[] = []
  let runningBalance = startingBalance
  let lowest: CashFlowForecastMarker | null = null
  let firstNegative: CashFlowForecastMarker | null = null

  for (let offset = 0; offset < horizonMonths; offset += 1) {
    const monthDate = addMonths(firstMonth, offset)
    const monthKey = monthKeyOf(monthDate)
    const monthLabel = MONTH_LABEL.format(monthDate)

    const { receivables, paymentOutflow, cardOutflow, loanOutflow, installmentOutflow, debtOutflow } = forecastBuckets(
      buildFinanceObligationsForMonth(obligationInput, monthDate, { from }),
    )

    const income = sumTL([salary, receivables])
    const outflow = sumTL([paymentOutflow, cardOutflow, loanOutflow, installmentOutflow, debtOutflow])
    const net = diffTL(income, outflow)
    runningBalance = sumTL([runningBalance, net])

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
