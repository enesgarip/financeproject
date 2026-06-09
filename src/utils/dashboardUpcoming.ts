import { formatDate } from './date'
import { formatCurrency } from './formatCurrency'
import {
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
