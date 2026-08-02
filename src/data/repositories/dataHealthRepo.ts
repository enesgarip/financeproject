import { supabase } from '../../lib/supabase'
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
  InsertFor,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
  TableName,
  UpdateFor,
} from '../../types/database'
import type { SupabaseLikeError } from '../../utils/supabaseErrors'
import { ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

const PAGE_SIZE = 500

type PagedRows<T> = {
  data: T[]
  error: SupabaseLikeError | null
}

async function fetchAllRows<T>(table: TableName): Promise<PagedRows<T>> {
  const rows: T[] = []
  let beforeId: string | null = null

  // Descending keyset pagination gives the first page a practical immutable-PK
  // upper bound. Requests are not one transaction snapshot, so concurrent
  // inserts/deletes may change membership; immutable cursors prevent offset
  // boundary shifts from skipping or duplicating rows that remain visible.
  for (;;) {
    let query = supabase
      .from(table as 'cards')
      .select('*')
      .order('id', { ascending: false })

    if (beforeId !== null) query = query.lt('id', beforeId)
    const { data, error } = await query.limit(PAGE_SIZE)

    if (error) return { data: rows.reverse(), error }

    const page = (data ?? []) as unknown as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows.reverse(), error: null }

    const nextBeforeId = (page.at(-1) as { id?: unknown } | undefined)?.id
    if (typeof nextBeforeId !== 'string') {
      return {
        data: rows.reverse(),
        error: { message: `${table} sayfalama anahtarı okunamadı.` },
      }
    }
    beforeId = nextBeforeId
  }
}

export type DataHealthRows = {
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

export type UndoTableName =
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

export type UndoRepositoryRow = Record<string, unknown> & { id: string }

export async function fetchDataHealthRows(): Promise<Result<DataHealthRows>> {
  const [
    assets,
    budgets,
    cards,
    cardExpenses,
    cardInstallments,
    cardStatementArchives,
    debts,
    loans,
    loanInstallments,
    payments,
    salaryHistory,
    savingsGoals,
    savingsGoalComponents,
    cardLedger,
    accountLedger,
  ] = await Promise.all([
    fetchAllRows<Asset>('assets'),
    fetchAllRows<Budget>('budgets'),
    fetchAllRows<Card>('cards'),
    fetchAllRows<CardExpense>('card_expenses'),
    fetchAllRows<CardInstallment>('card_installments'),
    fetchAllRows<CardStatementArchive>('card_statement_archives'),
    fetchAllRows<Debt>('debts'),
    fetchAllRows<Loan>('loans'),
    fetchAllRows<LoanInstallment>('loan_installments'),
    fetchAllRows<Payment>('payments'),
    fetchAllRows<SalaryHistory>('salary_history'),
    fetchAllRows<SavingsGoal>('savings_goals'),
    fetchAllRows<SavingsGoalComponent>('savings_goal_components'),
    fetchAllRows<CardLedger>('card_ledger'),
    fetchAllRows<AccountLedger>('account_ledger'),
  ])

  const errors = [
    assets.error,
    budgets.error,
    cards.error,
    cardExpenses.error,
    cardInstallments.error,
    cardStatementArchives.error,
    debts.error,
    loans.error,
    loanInstallments.error,
    payments.error,
    salaryHistory.error,
    savingsGoals.error,
    savingsGoalComponents.error,
    cardLedger.error,
    accountLedger.error,
  ].filter(Boolean)
  const error = errors.length > 0
    ? { ...errors[0]!, message: errors.map((e) => e!.message).join('; ') }
    : null

  return resultFromSupabase(
    {
      assets: (assets.data ?? []) as Asset[],
      budgets: (budgets.data ?? []) as Budget[],
      cards: (cards.data ?? []) as Card[],
      cardExpenses: (cardExpenses.data ?? []) as CardExpense[],
      cardInstallments: (cardInstallments.data ?? []) as CardInstallment[],
      cardLedger: (cardLedger.data ?? []) as CardLedger[],
      accountLedger: (accountLedger.data ?? []) as AccountLedger[],
      cardStatementArchives: (cardStatementArchives.data ?? []) as CardStatementArchive[],
      debts: (debts.data ?? []) as Debt[],
      loans: (loans.data ?? []) as Loan[],
      loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
      payments: (payments.data ?? []) as Payment[],
      salaryHistory: (salaryHistory.data ?? []) as SalaryHistory[],
      savingsGoals: (savingsGoals.data ?? []) as SavingsGoal[],
      savingsGoalComponents: (savingsGoalComponents.data ?? []) as SavingsGoalComponent[],
    },
    error,
    'Veri sağlığı kayıtları yüklenemedi.',
  )
}

export async function updateDataHealthRow<T extends TableName>(
  table: T,
  id: string,
  updates: UpdateFor<T>,
): Promise<Result<void>> {
  const { error } = await supabase
    .from(table as never)
    .update({ ...(updates as object), updated_at: new Date().toISOString() } as never)
    .eq('id', id)

  return voidResultFromSupabase(error, 'Kayıt güncellenemedi.')
}

export async function updateDataHealthRows<T extends TableName>(
  table: T,
  ids: string[],
  updates: UpdateFor<T>,
): Promise<Result<void>> {
  if (ids.length === 0) return ok(undefined)

  const { error } = await supabase
    .from(table as never)
    .update({ ...(updates as object), updated_at: new Date().toISOString() } as never)
    .in('id', ids)

  return voidResultFromSupabase(error, 'Kayıtlar güncellenemedi.')
}

export async function deleteDataHealthRows(table: UndoTableName, ids: string[]): Promise<Result<void>> {
  if (ids.length === 0) return ok(undefined)

  const { error } = await supabase.from(table as never).delete().in('id', ids)
  return voidResultFromSupabase(error, 'Kayıtlar silinemedi.')
}

export async function insertCardInstallments(rows: InsertFor<'card_installments'>[]): Promise<Result<string[]>> {
  if (rows.length === 0) return ok([])

  const { data, error } = await supabase.from('card_installments').insert(rows).select('id')
  return resultFromSupabase((data ?? []).map((row) => row.id).filter(Boolean), error, 'Eksik taksitler eklenemedi.')
}

export async function resetUserFinanceData(): Promise<Result<void>> {
  const { error } = await supabase.rpc('reset_user_finance_data', {})
  return voidResultFromSupabase(error, 'Tüm veri silinemedi.')
}

export async function fetchUndoRows(table: UndoTableName, ids: string[]): Promise<Result<UndoRepositoryRow[]>> {
  if (ids.length === 0) return ok([])

  const { data, error } = await supabase.from(table as never).select('*').in('id', ids)
  return resultFromSupabase((data ?? []) as unknown as UndoRepositoryRow[], error, 'Geri alma satırları yüklenemedi.')
}

export async function restoreUndoRows(table: UndoTableName, rows: UndoRepositoryRow[]): Promise<Result<void>> {
  if (rows.length === 0) return ok(undefined)

  const { error } = await supabase.from(table as never).upsert(rows as never)
  return voidResultFromSupabase(error, 'Geri alma satırları geri yüklenemedi.')
}
