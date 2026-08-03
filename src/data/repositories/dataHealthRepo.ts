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
  DataHealthIssueAcknowledgement,
  Debt,
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
import { appErrorFromSupabase, fail, ok, resultFromSupabase, voidResultFromSupabase, type Result } from '../result'

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

export type DataHealthWriteVersion = {
  id: string
  updatedAt: string
}

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

export async function fetchDataHealthIssueAcknowledgements(): Promise<Result<string[]>> {
  const rows = await fetchAllRows<DataHealthIssueAcknowledgement>('data_health_issue_acknowledgements')
  return resultFromSupabase(
    rows.data.map((row) => row.issue_id),
    rows.error,
    'Kapatılan veri sağlığı bulguları yüklenemedi.',
  )
}

export async function acknowledgeDataHealthIssues(issueIds: string[]): Promise<Result<void>> {
  const normalizedIds = [...new Set(issueIds.map((issueId) => issueId.trim()).filter(Boolean))]
  if (normalizedIds.length === 0) return ok(undefined)

  for (let index = 0; index < normalizedIds.length; index += 500) {
    const { error } = await supabase.rpc('acknowledge_data_health_issues', {
      p_issue_ids: normalizedIds.slice(index, index + 500),
    })
    if (error) return voidResultFromSupabase(error, 'Veri sağlığı bulgusu kapatılamadı.')
  }

  return ok(undefined)
}

export async function clearDataHealthIssueAcknowledgements(): Promise<Result<void>> {
  const { error } = await supabase.rpc('clear_data_health_issue_acknowledgements', {})
  return voidResultFromSupabase(error, 'Kapatılan veri sağlığı bulguları geri getirilemedi.')
}

export async function updateDataHealthRow<T extends TableName>(
  table: T,
  id: string,
  updates: UpdateFor<T>,
  expectedUpdatedAt: string,
): Promise<Result<DataHealthWriteVersion>> {
  const { data, error } = await supabase
    .from(table as never)
    .update({ ...(updates as object), updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('id, updated_at')

  if (error) return fail(appErrorFromSupabase(error, 'Kayıt güncellenemedi.'))

  const rows = (data ?? []) as Array<{ id?: unknown; updated_at?: unknown }>
  if (rows.length !== 1) {
    return fail({ type: 'unknown', message: 'Kayıt değişmiş, silinmiş veya erişilemez; düzeltme uygulanmadı.' })
  }

  const row = rows[0]
  if (typeof row?.id !== 'string' || typeof row.updated_at !== 'string') {
    return fail({ type: 'unknown', message: 'Güncellenen kaydın sürümü okunamadı; geri alma oluşturulmadı.' })
  }

  return ok({ id: row.id, updatedAt: row.updated_at })
}

export async function deleteDataHealthRows(table: UndoTableName, ids: string[]): Promise<Result<void>> {
  if (ids.length === 0) return ok(undefined)

  const uniqueIds = [...new Set(ids)]
  const { data, error } = await supabase.from(table as never).delete().in('id', uniqueIds).select('id')
  if (error) return voidResultFromSupabase(error, 'Kayıtlar silinemedi.')
  if ((data ?? []).length !== uniqueIds.length) {
    return fail({ type: 'unknown', message: 'Bazı kayıtlar silinemedi; sonuç yeniden taranmalıdır.' })
  }
  return ok(undefined)
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

export async function restoreDataHealthFields(
  table: UndoTableName,
  id: string,
  previousValues: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const fields = Object.keys(previousValues)
  const immutableFields = new Set(['id', 'user_id', 'created_at', 'updated_at'])
  if (fields.length === 0 || fields.some((field) => immutableFields.has(field))) {
    return fail({ type: 'unknown', message: 'Geri alma alanları güvenli değil; işlem uygulanmadı.' })
  }

  const { data, error } = await supabase
    .from(table as never)
    .update({ ...previousValues, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select('id')

  if (error) return voidResultFromSupabase(error, 'Geri alma alanları uygulanamadı.')
  if ((data ?? []).length !== 1) {
    return fail({ type: 'unknown', message: 'Kayıt düzeltmeden sonra değişmiş; geri alma uygulanmadı.' })
  }
  return ok(undefined)
}
