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
  CardStatementPayment,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
  SavingsGoalSource,
  TransactionHistory,
} from '../../types/database'
import { addMonths, dateInputValue, startOfMonth } from '../../utils/date'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage, type SupabaseLikeError } from '../../utils/supabaseErrors'
import { syncAutoValuedRows } from '../../utils/valuationSync'
import { resultFromSupabase, type Result } from '../result'

// Yıllık raporun cari ve önceki takvim yılını her ay eksiksiz karşılaştırabilmesi
// için 24 tamamlanmış ay + cari ay yüklenir. Ekranlar kendi penceresini daraltır.
export const SNAPSHOT_HISTORY_MONTHS = 25
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
  /** Kısmi ekstre ödemeleri (K7): kalan = arşiv tutarı − bu satırların toplamı. */
  cardStatementPayments: CardStatementPayment[]
  savingsGoals: SavingsGoal[]
  savingsGoalComponents: SavingsGoalComponent[]
  /** Hedeflerin takip kaynakları; biriken tutar bunlardan türetilir (goalSources.ts). */
  savingsGoalSources: SavingsGoalSource[]
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
    cardStatementPayments,
    savingsGoals,
    savingsGoalComponents,
    savingsGoalSources,
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
    supabase.from('card_statement_payments').select('*').order('paid_at', { ascending: false }),
    supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
    supabase.from('savings_goal_components').select('*'),
    supabase.from('savings_goal_sources').select('*').order('sort_order', { ascending: true }),
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
    cardStatementPayments: optionalRows(cardStatementPayments, 'card_statement_payments', missingTables),
    savingsGoals: optionalRows(savingsGoals, 'savings_goals', missingTables),
    savingsGoalComponents: optionalRows(savingsGoalComponents, 'savings_goal_components', missingTables),
    savingsGoalSources: optionalRows(savingsGoalSources, 'savings_goal_sources', missingTables),
    accountReconciliations: optionalRows(accountReconciliations, 'account_reconciliations', missingTables),
    missingTables,
  }
}

/** Vadesi gelen kart taksitlerini dönem içi borca alır; işlenen satır sayısını döndürür. */
export async function postDueCardInstallments(): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('post_due_card_installments')
  return resultFromSupabase(data ?? 0, error, 'Kart taksitleri dönem içine alınamadı.')
}

/**
 * Günlük bakım: vadesi gelen kart taksitlerini ve ekstre kesimlerini DB tarafında
 * işler, ardından canlı kurla otomatik değerlenen satırları tazeler. Kart talimatlı
 * ödemeler BM-5'ten beri proaktif yazılmaz — kayıt SMS/ekstre importundan gelir.
 * Kur senkronu best-effort'tur; bakım RPC hataları migration/RPC drift'i dahil görünür kalır.
 *
 * Dönüş: bakımın DEĞİŞTİRDİĞİ satır toplamı (taksit + kesim + değerleme). 0 ise
 * çağıranın snapshot'ı yeniden çekmesi gerekmez — çoğu koşuda durum budur.
 */
export async function runFinanceMaintenance(): Promise<number> {
  const valuationSync = (async () => {
    try {
      const snapshot = await ensureRatesLoaded()
      const result = await syncAutoValuedRows(snapshot)
      return result.updated
    } catch {
      // Kur kaynağı erişilemezse son kayıtlı değerlemeyle devam edilir.
      return 0
    }
  })()

  const cardInstallments = await supabase.rpc('post_due_card_installments')
  const statementCut = await supabase.rpc('cut_due_card_statements')
  const maintenanceError = [cardInstallments.error, statementCut.error].find(Boolean)
  if (maintenanceError) {
    await valuationSync
    throw new Error(financeMaintenanceErrorMessage(maintenanceError))
  }

  return (cardInstallments.data ?? 0) + (statementCut.data ?? 0) + (await valuationSync)
}
