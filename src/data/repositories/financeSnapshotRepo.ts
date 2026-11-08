import { readAllRows, sortRowsBy } from './readAllRows'
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
  FinanceSnapshotRpcPayload,
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
import { fetchCardInstallments, fetchStatementArchives, fetchStatementPayments } from './cardsRepo'

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

function rowsFromResult<T>(result: Result<T[]>): RowsResponse<T> {
  return result.ok ? { data: result.data, error: null } : { data: null, error: result.error }
}

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

/**
 * Açılış snapshot'ı tek istekte: fetch_finance_snapshot RPC'si (migration
 * 20260824220000) 17 sorgunun tamamını tek JSON yükünde döndürür — mobilde
 * 17 HTTP round-trip'i 1'e iner. Pencere/limit parametreleri buradan gider ki
 * SNAPSHOT_HISTORY_MONTHS ve STATEMENT_ARCHIVE_LIMIT'in tek kaynağı client kalsın.
 *
 * RPC henüz deploy edilmemiş ortamda (frontend DB'den önce çıktıysa) eski
 * tablo-tablo yola düşülür; eksik OPSİYONEL tabloları RPC'nin kendisi de
 * missing_tables olarak bildirir (optionalRows ikizi, graceful degradation).
 */
export async function fetchFinanceSnapshot(): Promise<FinanceSnapshot> {
  const windowStart = snapshotWindowStart()
  const { data, error } = await supabase.rpc('fetch_finance_snapshot', {
    p_window_start: windowStart.toISOString(),
    p_window_start_date: dateInputValue(windowStart),
    p_statement_limit: STATEMENT_ARCHIVE_LIMIT,
  })

  if (error) {
    if (isMissingSupabaseCapabilityError(error)) return fetchFinanceSnapshotViaTableQueries()
    throw new Error(error.message ?? 'Veri yüklenemedi.')
  }

  return snapshotFromRpcPayload(data)
}

function snapshotFromRpcPayload(payload: FinanceSnapshotRpcPayload): FinanceSnapshot {
  return {
    assets: payload.assets,
    cards: payload.cards,
    loans: payload.loans,
    loanInstallments: payload.loan_installments,
    debts: payload.debts,
    payments: payload.payments,
    salaryHistory: payload.salary_history,
    transactionHistory: payload.transaction_history,
    budgets: payload.budgets,
    cardExpenses: payload.card_expenses,
    cardInstallments: payload.card_installments,
    cardStatements: payload.card_statement_archives,
    cardStatementPayments: payload.card_statement_payments,
    savingsGoals: payload.savings_goals,
    savingsGoalComponents: payload.savings_goal_components,
    savingsGoalSources: payload.savings_goal_sources,
    accountReconciliations: payload.account_reconciliations,
    missingTables: payload.missing_tables,
  }
}

/**
 * Eski yol: 17 ayrı PostgREST isteği. RPC'nin fallback'i olarak yaşar
 * (migration bekleyen ortam) ve RPC ile alan alan aynı sonucu vermek
 * zorundadır — filtre/sıralama değişecekse İKİ yerde birden değişir
 * (RPC gövdesi + burası). Karşılaştırma testi: supabase/tests/finance_snapshot_rpc.sql.
 */
async function fetchFinanceSnapshotViaTableQueries(): Promise<FinanceSnapshot> {
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
    readAllRows('assets'),
    readAllRows('cards'),
    readAllRows('loans'),
    readAllRows('loan_installments'),
    readAllRows('debts'),
    readAllRows('payments'),
    readAllRows('salary_history').then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'effective_date', false) })),
    readAllRows('transaction_history', [{ column: 'occurred_at', op: 'gte', value: windowStart.toISOString() }]).then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'occurred_at') })),
    readAllRows('budgets', [{ column: 'month', op: 'gte', value: windowStartValue }]).then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'month') })),
    readAllRows('card_expenses', [{ column: 'spent_at', op: 'gte', value: windowStartValue }]).then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'spent_at') })),
    fetchCardInstallments().then(rowsFromResult),
    fetchStatementArchives(STATEMENT_ARCHIVE_LIMIT).then(rowsFromResult),
    fetchStatementPayments().then(rowsFromResult),
    readAllRows('savings_goals').then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'created_at', false) })),
    readAllRows('savings_goal_components'),
    readAllRows('savings_goal_sources').then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'sort_order', true) })),
    readAllRows('account_reconciliations').then(result => ({ ...result, data: result.data && sortRowsBy(result.data, 'reconciled_at', false) })),
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
 * Dönüş: bakımın DEĞİŞTİRDİĞİ satır toplamı (taksit + kesim + ödeme eşleştirme + değerleme). 0 ise
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
  const paymentMatches = await supabase.rpc('reconcile_card_payment_expenses')
  const maintenanceError = [cardInstallments.error, statementCut.error, paymentMatches.error].find(Boolean)
  if (maintenanceError) {
    await valuationSync
    throw new Error(financeMaintenanceErrorMessage(maintenanceError))
  }

  return (cardInstallments.data ?? 0) + (statementCut.data ?? 0) + (paymentMatches.data ?? 0) + (await valuationSync)
}
