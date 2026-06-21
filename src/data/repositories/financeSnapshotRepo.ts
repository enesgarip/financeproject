import { ensureRatesLoaded } from '../../lib/marketRatesClient'
import { supabase } from '../../lib/supabase'
import type {
  AccountReconciliation,
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
  TransactionHistory,
} from '../../types/database'
import { addMonths, dateInputValue, startOfMonth } from '../../utils/date'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../../utils/supabaseErrors'
import { syncAutoValuedRows } from '../../utils/valuationSync'
import { resultFromSupabase, type Result } from '../result'

// Dashboard (3-4 ay) ile Analiz (6 ay) pencerelerinin süperseti: tek sorgu seti
// iki sayfayı da besler, sayfalar kendi penceresini client tarafında daraltır.
export const SNAPSHOT_HISTORY_MONTHS = 6
const STATEMENT_ARCHIVE_LIMIT = 120

export type FinanceSnapshot = {
  assets: Asset[]
  cards: Card[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  transactionHistory: TransactionHistory[]
  budgets: Budget[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardStatements: CardStatementArchive[]
  savingsGoals: SavingsGoal[]
  savingsGoalComponents: SavingsGoalComponent[]
  accountReconciliations: AccountReconciliation[]
  /** Şemada henüz olmayan opsiyonel tablolar (migration bekleyen ortamlar). */
  missingTables: string[]
}

type RowsResponse<T> = { data: T[] | null; error: SupabaseLikeError | null }

function requiredRows<T>(response: RowsResponse<T>): T[] {
  if (response.error) throw new Error(response.error.message ?? 'Veri yüklenemedi.')
  return response.data ?? []
}

function optionalRows<T>(response: RowsResponse<T>, table: string, missingTables: string[]): T[] {
  if (!response.error) return response.data ?? []
  if (isMissingSupabaseCapabilityError(response.error)) {
    missingTables.push(table)
    return []
  }
  throw new Error(response.error.message ?? 'Veri yüklenemedi.')
}

function financeMaintenanceErrorMessage(error: SupabaseLikeError) {
  if (isMissingSupabaseCapabilityError(error)) {
    return missingSupabaseCapabilityMessage('Finans bakım altyapısı', error)
  }
  return error.message ?? 'Finans bakımı çalıştırılamadı.'
}

/** Pencere başlangıcı: ay başından SNAPSHOT_HISTORY_MONTHS-1 ay geriye. */
export function snapshotWindowStart(): Date {
  return addMonths(startOfMonth(), 1 - SNAPSHOT_HISTORY_MONTHS)
}

export async function fetchFinanceSnapshot(): Promise<FinanceSnapshot> {
  const windowStart = snapshotWindowStart()
  const windowStartValue = dateInputValue(windowStart)

  const [
    assets,
    cards,
    loans,
    loanInstallments,
    debts,
    payments,
    salaryHistory,
    transactionHistory,
    budgets,
    cardExpenses,
    cardInstallments,
    cardStatements,
    savingsGoals,
    savingsGoalComponents,
    accountReconciliations,
  ] = await Promise.all([
    supabase.from('assets').select('*'),
    supabase.from('cards').select('*'),
    supabase.from('loans').select('*'),
    supabase.from('loan_installments').select('*'),
    supabase.from('debts').select('*'),
    supabase.from('payments').select('*'),
    supabase.from('salary_history').select('*').order('effective_date', { ascending: false }),
    supabase.from('transaction_history').select('*').gte('occurred_at', windowStart.toISOString()).order('occurred_at', { ascending: false }),
    supabase.from('budgets').select('*').gte('month', windowStartValue).order('month', { ascending: false }),
    supabase.from('card_expenses').select('*').gte('spent_at', windowStartValue).order('spent_at', { ascending: false }),
    supabase.from('card_installments').select('*').order('due_month', { ascending: true }),
    supabase.from('card_statement_archives').select('*').order('statement_date', { ascending: false }).limit(STATEMENT_ARCHIVE_LIMIT),
    supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
    supabase.from('savings_goal_components').select('*'),
    supabase.from('account_reconciliations').select('*').order('reconciled_at', { ascending: false }),
  ])

  const missingTables: string[] = []

  return {
    assets: requiredRows(assets),
    cards: requiredRows(cards),
    loans: requiredRows(loans),
    loanInstallments: requiredRows(loanInstallments),
    debts: requiredRows(debts),
    payments: requiredRows(payments),
    salaryHistory: requiredRows(salaryHistory),
    transactionHistory: requiredRows(transactionHistory),
    budgets: optionalRows(budgets, 'budgets', missingTables),
    cardExpenses: requiredRows(cardExpenses),
    cardInstallments: optionalRows(cardInstallments, 'card_installments', missingTables),
    cardStatements: optionalRows(cardStatements, 'card_statement_archives', missingTables),
    savingsGoals: optionalRows(savingsGoals, 'savings_goals', missingTables),
    savingsGoalComponents: optionalRows(savingsGoalComponents, 'savings_goal_components', missingTables),
    accountReconciliations: optionalRows(accountReconciliations, 'account_reconciliations', missingTables),
    missingTables,
  }
}

/** Vadesi gelen banka talimatlarını karta borç olarak işler; işlenen kayıt sayısını döndürür. */
export async function postDueCardAutoPayments(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('post_due_card_auto_payments')
  return resultFromSupabase(data ?? 0, error, 'Otomatik ödemeler işlenemedi.')
}

/**
 * Günlük bakım: vadesi gelen kart otomatik ödemelerini ve ekstre kesimlerini
 * DB tarafında işler, ardından canlı kurla otomatik değerlenen satırları tazeler.
 * Kur senkronu best-effort'tur; bakım RPC hataları migration/RPC drift'i dahil görünür kalır.
 */
export async function runFinanceMaintenance(): Promise<void> {
  const valuationSync = (async () => {
    try {
      const snapshot = await ensureRatesLoaded()
      await syncAutoValuedRows(snapshot)
    } catch {
      // Kur kaynağı erişilemezse son kayıtlı değerlemeyle devam edilir.
    }
  })()

  const autoPayments = await supabase.rpc('post_due_card_auto_payments')
  const statementCut = await supabase.rpc('cut_due_card_statements')
  const maintenanceError = [autoPayments.error, statementCut.error].find(Boolean)
  if (maintenanceError) {
    await valuationSync
    throw new Error(financeMaintenanceErrorMessage(maintenanceError))
  }

  await valuationSync
}
