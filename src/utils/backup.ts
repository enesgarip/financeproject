import {
  deleteOwnRows,
  fetchTableRows,
  insertRows,
  type BackupRow,
} from '../data/repositories/backupRepo'

/**
 * Full finance-data backup & restore (roadmap D8).
 *
 * Export: user-owned finance/support tables → one JSON file (`financeproject-v2`). Restore:
 * wipe own rows child-first, insert backup rows parent-first (FK-safe), with
 * user_id rewritten to the signed-in user so a backup survives an account
 * re-create. Also accepts the older DataHealth export (`financeproject-v1`).
 *
 * card_ledger is exported for audit but never restored: it is append-only by
 * design, and the cards trigger regenerates opening events on insert, so the
 * ledger restarts honestly from the restore point.
 */

/** Insert order, parents first; wipe runs in reverse. */
export const RESTORE_TABLE_ORDER = [
  'cards',
  'card_aliases',
  'assets',
  'loans',
  'savings_goals',
  'budgets',
  'debts',
  'salary_history',
  'gold_lots',
  'net_worth_snapshots',
  'card_statement_archives',
  'card_expenses',
  'card_installments',
  'loan_installments',
  'savings_goal_components',
  'payments',
  'transaction_history',
  'account_reconciliations',
  'dismissed_upcoming_items',
  'push_subscriptions',
] as const

export type RestoreTable = (typeof RESTORE_TABLE_ORDER)[number]

/** Exported but intentionally never restored. */
const EXPORT_ONLY_TABLES = ['card_ledger', 'account_ledger', 'sms_log', 'notification_log'] as const

const BACKUP_SCHEMA_V2 = 'financeproject-v2'
const BACKUP_SCHEMA_V1 = 'financeproject-v1'

/** v1 (DataHealth HealthData) key → table name. */
const V1_KEY_TO_TABLE: Record<string, RestoreTable> = {
  assets: 'assets',
  budgets: 'budgets',
  cards: 'cards',
  cardExpenses: 'card_expenses',
  cardInstallments: 'card_installments',
  cardStatementArchives: 'card_statement_archives',
  debts: 'debts',
  loans: 'loans',
  loanInstallments: 'loan_installments',
  payments: 'payments',
  salaryHistory: 'salary_history',
  savingsGoals: 'savings_goals',
  savingsGoalComponents: 'savings_goal_components',
}

export type { BackupRow }

export type ParsedBackup = {
  schema: string
  exportedAt: string | null
  /** Restorable rows keyed by table name (export-only tables are dropped). */
  tables: Partial<Record<RestoreTable, BackupRow[]>>
  /** Non-empty tables with their row counts, in restore order. */
  counts: Array<{ table: RestoreTable; rows: number }>
  totalRows: number
}

/**
 * Parse and validate a backup file. Throws a Turkish error message when the
 * file is not a recognisable backup.
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Dosya okunamadı: geçerli bir JSON değil.')
  }

  if (typeof raw !== 'object' || raw === null) throw new Error('Dosya bir yedek dosyası değil.')
  const root = raw as Record<string, unknown>
  const schema = typeof root.schema === 'string' ? root.schema : ''

  const tables: Partial<Record<RestoreTable, BackupRow[]>> = {}

  if (schema === BACKUP_SCHEMA_V2 && typeof root.tables === 'object' && root.tables !== null) {
    for (const table of RESTORE_TABLE_ORDER) {
      const rows = (root.tables as Record<string, unknown>)[table]
      if (Array.isArray(rows)) tables[table] = rows as BackupRow[]
    }
  } else if (schema === BACKUP_SCHEMA_V1 && typeof root.data === 'object' && root.data !== null) {
    for (const [key, table] of Object.entries(V1_KEY_TO_TABLE)) {
      const rows = (root.data as Record<string, unknown>)[key]
      if (Array.isArray(rows)) tables[table] = rows as BackupRow[]
    }
  } else {
    throw new Error('Tanınmayan yedek formatı. "JSON yedek" ile alınmış bir dosya seç.')
  }

  const counts = RESTORE_TABLE_ORDER.filter((table) => (tables[table]?.length ?? 0) > 0).map((table) => ({
    table,
    rows: tables[table]!.length,
  }))
  const totalRows = counts.reduce((sum, item) => sum + item.rows, 0)
  if (totalRows === 0) throw new Error('Yedek dosyası boş: geri yüklenecek kayıt yok.')

  return {
    schema,
    exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : null,
    tables,
    counts,
    totalRows,
  }
}

/** Rewrite ownership so the backup can be restored into any account. */
export function rowForInsert(row: BackupRow, userId: string): BackupRow {
  return { ...row, user_id: userId }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

/** Fetch every table and build the v2 backup payload. */
export async function buildBackupPayload(): Promise<{ payload: string; totalRows: number }> {
  const tables: Record<string, BackupRow[]> = {}
  let totalRows = 0

  for (const table of [...RESTORE_TABLE_ORDER, ...EXPORT_ONLY_TABLES]) {
    const rows = await fetchTableRows(table)
    if (rows === null) continue // table not deployed yet
    tables[table] = rows
    totalRows += rows.length
  }

  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), schema: BACKUP_SCHEMA_V2, tables }, null, 2)
  return { payload, totalRows }
}

/** Trigger a browser download of a backup payload. */
export function downloadBackupFile(payload: string, prefix = 'financeproject-backup') {
  const date = new Date().toISOString().slice(0, 10)
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${prefix}-${date}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export type RestoreProgress = { step: string; done: number; total: number }

/**
 * Wipe own data (reverse FK order) and insert the backup (FK order, chunked).
 * NOT transactional over REST — the caller must take a safety export first and
 * warn the user. RLS scopes every statement to the signed-in user.
 */
export async function restoreBackup(
  backup: ParsedBackup,
  userId: string,
  onProgress?: (progress: RestoreProgress) => void,
): Promise<void> {
  const steps = RESTORE_TABLE_ORDER.length * 2
  let done = 0

  // Wipe child-first. Missing tables (not deployed) are skipped.
  for (const table of [...RESTORE_TABLE_ORDER].reverse()) {
    onProgress?.({ step: `${table} temizleniyor`, done: ++done, total: steps })
    await deleteOwnRows(table, userId)
  }

  // Insert parent-first.
  for (const table of RESTORE_TABLE_ORDER) {
    onProgress?.({ step: `${table} geri yükleniyor`, done: ++done, total: steps })
    const rows = backup.tables[table]
    if (!rows || rows.length === 0) continue

    for (const part of chunk(rows, 200)) {
      const deployed = await insertRows(table, part.map((row) => rowForInsert(row, userId)))
      if (!deployed) break // table not deployed: skip its rows
    }
  }
}

export const BACKUP_TABLE_LABELS: Record<RestoreTable, string> = {
  cards: 'Hesap/Kart',
  card_aliases: 'Kart takma adı',
  assets: 'Varlık',
  loans: 'Kredi',
  savings_goals: 'Hedef',
  budgets: 'Bütçe',
  debts: 'Kişi borcu/alacağı',
  salary_history: 'Maaş kaydı',
  gold_lots: 'Altın alımı',
  net_worth_snapshots: 'Net değer fotoğrafı',
  card_statement_archives: 'Ekstre arşivi',
  card_expenses: 'Kart harcaması',
  card_installments: 'Kart taksidi',
  loan_installments: 'Kredi taksidi',
  savings_goal_components: 'Hedef bileşeni',
  payments: 'Planlı ödeme',
  transaction_history: 'İşlem geçmişi',
  account_reconciliations: 'Mutabakat kaydı',
  dismissed_upcoming_items: 'Gizlenen yaklaşan kayıt',
  push_subscriptions: 'Push aboneliği',
}
