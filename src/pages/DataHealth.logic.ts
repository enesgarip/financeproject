import type {
  AccountLedger,
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
  CardLedger,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
} from '../types/database'
import { dateInputValue } from '../utils/date'
import {
  checkAssets,
  checkBudgets,
  checkCardInstallments,
  checkCardExpenseDuplicates,
  checkCards,
  checkDebts,
  checkGoals,
  checkLedgerDrift,
  checkLoans,
  checkPayments,
  checkSalary,
} from './DataHealth.checks'

export type HealthData = {
  assets: Asset[]
  budgets: Budget[]
  cards: Card[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardLedger: CardLedger[]
  accountLedger: AccountLedger[]
  cardStatementArchives: CardStatementArchive[]
  debts: Debt[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  savingsGoals: SavingsGoal[]
  savingsGoalComponents: SavingsGoalComponent[]
}

export type HealthIssue = {
  id: string
  area: 'Varlıklar' | 'Bütçeler' | 'Kartlar' | 'Krediler' | 'Kişiler' | 'Planlı' | 'Maaş' | 'Hedefler'
  severity: 'error' | 'warning' | 'info'
  title: string
  description: string
  details: string[]
  fixable: boolean
  fixLabel?: string
  kind:
    | 'cardDebtSplit'
    | 'cardTypeFields'
    | 'cardExpenseAmount'
    | 'cardSingleInstallments'
    | 'cardMissingInstallments'
    | 'cardInstallmentDueMonth'
    | 'cardInstallmentPostedAt'
    | 'cardInstallmentCount'
    | 'cardStatementTotals'
    | 'cardStatementStatus'
    | 'cardOverduePayment'
    | 'cardScheduledDebt'
    | 'cardLedgerDrift'
    | 'duplicateTransactionCandidate'
    | 'cardExpenseDataQuality'
    | 'accountLedgerDrift'
    | 'assetShape'
    | 'budgetMonth'
    | 'debtShape'
    | 'loanTotals'
    | 'loanInstallmentDueDay'
    | 'loanPaidAtMissing'
    | 'loanPendingPaidAt'
    | 'paymentRecurrenceFields'
    | 'paymentDueDay'
    | 'manual'
  payload?: {
    assetId?: string
    budgetId?: string
    cardId?: string
    debtId?: string
    loanId?: string
    paymentId?: string
    statementArchiveId?: string
    ids?: string[]
    updates?: Record<string, string | number | null>
    statementDebt?: number
    currentPeriod?: number
    provisionAmount?: number
    scheduledTotal?: number
    nextDebtAmount?: number
    remainingAmount?: number
    remainingInstallments?: number
    loanStatus?: Loan['status']
    dueDate?: string
    userId?: string
    expenseId?: string
    cardExpenseId?: string
    installmentNos?: number[]
    installmentCount?: number
    baseDate?: string
    amount?: number
    totalAmount?: number
    description?: string
    category?: string
    duplicateLevel?: 'exact' | 'possible'
    confidence?: number
    transactionFingerprint?: string
  }
}

export type UndoTable =
  | 'assets'
  | 'budgets'
  | 'cards'
  | 'card_expenses'
  | 'card_installments'
  | 'card_statement_archives'
  | 'debts'
  | 'loans'
  | 'loan_installments'
  | 'payments'

export type UndoRow = Record<string, unknown> & { id: string }

export type UndoEntry =
  | {
      action: 'restoreRows'
      table: UndoTable
      rows: UndoRow[]
    }
  | {
      action: 'deleteRows'
      table: UndoTable
      ids: string[]
    }

export type UndoBatch = {
  id: string
  label: string
  createdAt: string
  entries: UndoEntry[]
}

export function currentMonthStart() {
  const today = new Date()
  return dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1))
}

export function addMonthsToDate(value: string, months: number) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month) return currentMonthStart()
  const targetMonthLastDay = new Date(year, month - 1 + months + 1, 0).getDate()
  return dateInputValue(new Date(year, month - 1 + months, Math.min(day || 1, targetMonthLastDay)))
}

export function buildIssues(data: HealthData): HealthIssue[] {
  const issues: HealthIssue[] = [
    ...checkAssets(data.assets),
    ...checkBudgets(data.budgets),
    ...checkCards(data.cards, data.cardInstallments, data.cardStatementArchives),
    ...checkCardExpenseDuplicates(data.cards, data.cardExpenses),
    ...checkLedgerDrift(data.cards, data.cardLedger, data.accountLedger),
    ...checkCardInstallments(data.cards, data.cardExpenses, data.cardInstallments),
    ...checkLoans(data.loans, data.loanInstallments),
    ...checkDebts(data.debts),
    ...checkSalary(data.salaryHistory),
    ...checkGoals(data.savingsGoals, data.savingsGoalComponents),
    ...checkPayments(data.payments),
  ]

  return issues.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 }
    return severityOrder[a.severity] - severityOrder[b.severity] || a.area.localeCompare(b.area, 'tr-TR')
  })
}
