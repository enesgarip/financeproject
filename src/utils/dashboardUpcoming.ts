import { formatDate, startOfMonth } from './date'
import { formatCurrency } from './formatCurrency'
import { sumTL } from './money'
import {
  buildFinanceObligationsForMonth,
  buildFinanceObligationsForRange,
  type FinanceObligation,
  type FinanceObligationsInput,
  type FinanceObligationSettlement,
} from './obligations'

export type DashboardUpcomingItem = {
  id: string
  title: string
  subtitle: string
  value: string
  amount: number
  cashImpactAmount: number
  settlement: FinanceObligationSettlement
  kind: 'payment' | 'card' | 'loan' | 'debt'
  date: string
  sortTime: number
}

export type DashboardMonthlyLoadSummary = {
  monthLabel: string
  total: number
  payments: number
  cardStatements: number
  cardInstallments: number
  loanInstallments: number
  legacyLoanInstallments: number
  personalDebts: number
}

function obligationKindToDashboardKind(kind: FinanceObligation['kind']): DashboardUpcomingItem['kind'] {
  if (kind === 'payment') return 'payment'
  if (kind === 'loan_installment' || kind === 'legacy_loan_installment') return 'loan'
  if (kind === 'personal_debt' || kind === 'personal_receivable') return 'debt'
  return 'card'
}

export function obligationToDashboardUpcomingItem(item: FinanceObligation): DashboardUpcomingItem {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    value: formatCurrency(item.amount),
    amount: item.amount,
    cashImpactAmount: item.cashImpactAmount ?? item.amount,
    settlement: item.settlement ?? 'cash',
    kind: obligationKindToDashboardKind(item.kind),
    date: formatDate(item.date),
    sortTime: new Date(`${item.date}T00:00:00`).getTime(),
  }
}

export function buildDashboardUpcomingItems(data: FinanceObligationsInput, days = 30, from = new Date()): DashboardUpcomingItem[] {
  return buildFinanceObligationsForRange(data, { days, from })
    .filter((item) => item.direction === 'outflow')
    .map(obligationToDashboardUpcomingItem)
}

export function buildDashboardMonthlyLoad(
  data: FinanceObligationsInput,
  month: Date,
  from = new Date(),
): DashboardMonthlyLoadSummary {
  const monthStart = startOfMonth(month)
  const items = buildFinanceObligationsForMonth(data, monthStart, { from })
  const paymentItems = items.filter((item) => item.kind === 'payment')
  const cardStatementItems = items.filter((item) => item.kind === 'card_statement' || item.kind === 'card_debt')
  const cardInstallmentItems = items.filter((item) => item.kind === 'card_installment')
  const loanInstallmentItems = items.filter((item) => item.kind === 'loan_installment')
  const legacyLoanInstallmentItems = items.filter((item) => item.kind === 'legacy_loan_installment')
  const personalDebtItems = items.filter((item) => item.kind === 'personal_debt')

  const payments = sumTL(paymentItems.map((item) => item.amount))
  const cardStatements = sumTL(cardStatementItems.map((item) => item.amount))
  const cardInstallments = sumTL(cardInstallmentItems.map((item) => item.amount))
  const loanInstallments = sumTL(loanInstallmentItems.map((item) => item.amount))
  const legacyLoanInstallments = sumTL(legacyLoanInstallmentItems.map((item) => item.amount))
  const personalDebts = sumTL(personalDebtItems.map((item) => item.amount))

  return {
    monthLabel: new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(monthStart),
    total: sumTL([payments, cardStatements, cardInstallments, loanInstallments, legacyLoanInstallments, personalDebts]),
    payments,
    cardStatements,
    cardInstallments,
    loanInstallments,
    legacyLoanInstallments,
    personalDebts,
  }
}
