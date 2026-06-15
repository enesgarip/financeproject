import type {
  Asset,
  Budget,
  Card as FinanceCard,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  TransactionHistory,
} from '../types/database'
import { dateInputValue, startOfMonth } from './date'
import { formatCurrency } from './formatCurrency'
import { activeExpense as activeCardExpense } from './budgetAlerts'
import {
  buildFinanceObligationsForMonth,
  type FinanceObligation,
  type FinanceObligationsInput,
} from './obligations'
import type { FinanceSummaryInput } from './financeSummary'

/**
 * Analiz sayfasının saf türetme çekirdeği (view-model'ler): arama/CSV listesi,
 * takvim olayları, kategori içgörüleri. JSX panelleri `pages/AnalysisPage.tsx`'te
 * kalır; buradaki her şey test edilebilir saf fonksiyondur.
 */

export type AnalysisData = {
  assets: Asset[]
  cards: FinanceCard[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  transactionHistory: TransactionHistory[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardStatementArchives: CardStatementArchive[]
  budgets: Budget[]
  savingsGoals: SavingsGoal[]
}

export type SearchItem = {
  type: string
  title: string
  subtitle: string
  amount: number | null
  date: string | null
}

export type CalendarEvent = {
  id: string
  date: string
  title: string
  amount: number
  tone: 'emerald' | 'rose' | 'amber' | 'stone'
}

export type CategoryInsight = {
  category: string
  title: string
  description: string
  tone: 'emerald' | 'amber' | 'rose'
  priority: number
  amount: number
}

export function formatMonth(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
}

export function monthKeyFor(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  return dateInputValue(startOfMonth(Number.isNaN(date.getTime()) ? new Date() : date))
}

export function previousMonthKeys(count: number): string[] {
  const today = new Date()
  return Array.from({ length: count }, (_, index) =>
    dateInputValue(startOfMonth(new Date(today.getFullYear(), today.getMonth() - index - 1, 1))),
  )
}

export function buildSearchItems(data: AnalysisData): SearchItem[] {
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))

  return [
    ...data.assets.map((asset) => ({
      type: 'Varlık',
      title: asset.name,
      subtitle: asset.category,
      amount: asset.estimated_value_try,
      date: asset.updated_at,
    })),
    ...data.cards.map((card) => ({
      type: 'Kart',
      title: `${card.bank_name} ${card.card_name}`,
      subtitle: card.card_type === 'kredi_karti' ? 'Kredi kartı' : 'Banka kartı',
      amount: card.card_type === 'kredi_karti' ? card.debt_amount : card.current_balance,
      date: card.updated_at,
    })),
    ...data.cardExpenses.filter(activeCardExpense).map((expense) => ({
      type: expense.status === 'provision' ? 'Kart provizyonu' : 'Kart harcaması',
      title: expense.description,
      subtitle: `${cardsById.get(expense.card_id)?.card_name ?? 'Kart'} · ${expense.category ?? 'Diğer'}`,
      amount: expense.amount,
      date: expense.spent_at,
    })),
    ...data.loans.map((loan) => ({
      type: 'Kredi',
      title: loan.loan_name,
      subtitle: loan.bank_name,
      amount: loan.remaining_amount,
      date: loan.end_date,
    })),
    ...data.payments.map((payment) => ({
      type: 'Ödeme',
      title: payment.title,
      subtitle: payment.category,
      amount: payment.amount,
      date: payment.due_date,
    })),
    ...data.debts.map((debt) => ({
      type: debt.direction === 'borç_aldım' ? 'Borç' : 'Alacak',
      title: debt.person_name,
      subtitle: debt.status,
      amount: debt.estimated_value_try,
      date: debt.due_date,
    })),
    ...data.budgets.map((budget) => ({
      type: 'Bütçe',
      title: budget.category,
      subtitle: formatMonth(budget.month),
      amount: budget.limit_amount,
      date: budget.month,
    })),
    ...data.savingsGoals.map((goal) => ({
      type: 'Birikim hedefi',
      title: goal.name,
      subtitle: goal.status === 'active' ? 'Aktif' : 'Tamamlandı',
      amount: goal.current_amount,
      date: goal.target_date,
    })),
    ...data.transactionHistory.map((row) => ({
      type: 'Geçmiş',
      title: row.title,
      subtitle: row.note ?? row.type,
      amount: row.amount,
      date: row.occurred_at,
    })),
  ].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
}

function csvValue(value: string | number | null | undefined): string {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

/** Arama listesini CSV metnine çevirir (DOM indirme çağıranın işi). */
export function buildSearchCsv(items: SearchItem[]): string {
  const rows = [
    ['Tur', 'Baslik', 'Detay', 'Tutar', 'Tarih'],
    ...items.map((item) => [item.type, item.title, item.subtitle, item.amount ?? '', item.date ?? '']),
  ]
  return rows.map((row) => row.map(csvValue).join(',')).join('\n')
}

export function analysisObligationsInput(data: AnalysisData): FinanceObligationsInput {
  return {
    cards: data.cards,
    payments: data.payments,
    loans: data.loans,
    loanInstallments: data.loanInstallments,
    debts: data.debts,
    cardInstallments: data.cardInstallments,
    cardStatements: data.cardStatementArchives,
  }
}

export function analysisFinanceSummaryInput(data: AnalysisData): FinanceSummaryInput {
  return {
    assets: data.assets,
    cards: data.cards,
    loans: data.loans,
    loanInstallments: data.loanInstallments,
    debts: data.debts,
    payments: data.payments,
    salaryHistory: data.salaryHistory,
    cardInstallments: data.cardInstallments,
    cardStatements: data.cardStatementArchives,
    savingsGoals: data.savingsGoals,
  }
}

export function obligationCalendarTone(item: FinanceObligation): CalendarEvent['tone'] {
  if (item.direction === 'inflow') return 'emerald'
  if (item.settlement === 'credit_card') return 'stone'
  if (item.isEstimate) return 'amber'
  return 'rose'
}

// Reads the same obligation engine as the dashboard cash calendar, so both
// screens list the identical items, dates and amounts for the month.
export function buildCalendarEvents(data: AnalysisData): CalendarEvent[] {
  return buildFinanceObligationsForMonth(analysisObligationsInput(data), startOfMonth()).map((item) => ({
    id: item.id,
    date: item.date,
    title: item.title,
    amount: item.amount,
    tone: obligationCalendarTone(item),
  }))
}

export function buildCategoryInsights(data: AnalysisData): CategoryInsight[] {
  const currentMonth = dateInputValue(startOfMonth())
  const previousMonths = previousMonthKeys(3)
  const currentTotals = new Map<string, number>()
  const previousTotals = new Map<string, number>()
  const budgetsByCategory = new Map(
    data.budgets.filter((budget) => budget.month === currentMonth).map((budget) => [budget.category, budget]),
  )

  for (const expense of data.cardExpenses.filter(activeCardExpense)) {
    const category = expense.category || 'Diğer'
    const expenseMonth = monthKeyFor(expense.spent_at)

    if (expenseMonth === currentMonth) {
      currentTotals.set(category, (currentTotals.get(category) ?? 0) + expense.amount)
    } else if (previousMonths.includes(expenseMonth)) {
      previousTotals.set(category, (previousTotals.get(category) ?? 0) + expense.amount)
    }
  }

  return Array.from(currentTotals, ([category, amount]) => {
    const budget = budgetsByCategory.get(category)
    const average = (previousTotals.get(category) ?? 0) / 3
    const limitRate = budget && budget.limit_amount > 0 ? amount / budget.limit_amount : 0

    if (budget && limitRate >= 1) {
      return {
        category,
        title: 'Bütçe aşıldı',
        description: `${formatCurrency(amount)} harcandı; limit ${formatCurrency(budget.limit_amount)}.`,
        tone: 'rose' as const,
        priority: 1,
        amount,
      }
    }

    if (budget && limitRate >= 0.8) {
      return {
        category,
        title: `Limitin %${Math.round(limitRate * 100)} doldu`,
        description: `${formatCurrency(Math.max(0, budget.limit_amount - amount))} alan kaldı.`,
        tone: 'amber' as const,
        priority: 2,
        amount,
      }
    }

    if (average > 0 && amount >= average * 1.25) {
      return {
        category,
        title: 'Son 3 ay ortalamasının üstünde',
        description: `Bu ay ${formatCurrency(amount)}, üç aylık ortalama ${formatCurrency(average)}.`,
        tone: 'amber' as const,
        priority: 3,
        amount,
      }
    }

    if (average > 0 && amount <= average * 0.75) {
      return {
        category,
        title: 'Ortalamanın altında',
        description: `Bu ay tempo ${formatCurrency(average - amount)} daha düşük görünüyor.`,
        tone: 'emerald' as const,
        priority: 6,
        amount,
      }
    }

    return null
  })
    .filter((item): item is CategoryInsight => Boolean(item))
    .sort((a, b) => a.priority - b.priority || b.amount - a.amount)
    .slice(0, 3)
}
