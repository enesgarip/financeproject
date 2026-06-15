import { deleteDataHealthRows, fetchUndoRows, restoreUndoRows as restoreUndoRepositoryRows } from '../data/repositories/dataHealthRepo'
import { dateInputValue } from '../utils/date'
import type { HealthData, UndoBatch, UndoEntry, UndoRow, UndoTable } from './DataHealth.logic'

export const emptyData: HealthData = {
  assets: [],
  budgets: [],
  cards: [],
  cardExpenses: [],
  cardInstallments: [],
  cardLedger: [],
  accountLedger: [],
  cardStatementArchives: [],
  debts: [],
  loans: [],
  loanInstallments: [],
  payments: [],
  salaryHistory: [],
  savingsGoals: [],
  savingsGoalComponents: [],
}

const exportTables = [
  { key: 'assets', table: 'assets' },
  { key: 'budgets', table: 'budgets' },
  { key: 'cards', table: 'cards' },
  { key: 'cardExpenses', table: 'card_expenses' },
  { key: 'cardInstallments', table: 'card_installments' },
  { key: 'cardStatementArchives', table: 'card_statement_archives' },
  { key: 'debts', table: 'debts' },
  { key: 'loans', table: 'loans' },
  { key: 'loanInstallments', table: 'loan_installments' },
  { key: 'payments', table: 'payments' },
  { key: 'salaryHistory', table: 'salary_history' },
  { key: 'savingsGoals', table: 'savings_goals' },
  { key: 'savingsGoalComponents', table: 'savings_goal_components' },
] satisfies Array<{ key: keyof HealthData; table: string }>

function newUndoId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function makeUndoBatch(label: string, entries: UndoEntry[]): UndoBatch | null {
  if (entries.length === 0) return null
  return {
    id: newUndoId(),
    label,
    createdAt: new Date().toISOString(),
    entries,
  }
}

function compactIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))]
}

function exportFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function exportRowLabel(row: Record<string, unknown>) {
  const keys = ['name', 'card_name', 'loan_name', 'title', 'person_name', 'description', 'label', 'bank_name']
  return keys.map((key) => row[key]).find((value) => typeof value === 'string' && value.trim()) ?? ''
}

function exportRowAmount(row: Record<string, unknown>) {
  const keys = ['estimated_value_try', 'statement_debt_amount', 'debt_amount', 'remaining_amount', 'current_balance', 'amount', 'target_amount']
  return keys.map((key) => row[key]).find((value) => typeof value === 'number') ?? ''
}

function exportRowDate(row: Record<string, unknown>) {
  const keys = ['due_date', 'statement_date', 'due_month', 'spent_at', 'effective_date', 'target_date', 'created_at']
  return keys.map((key) => row[key]).find((value) => typeof value === 'string' && value) ?? ''
}

export function downloadDataJson(data: HealthData) {
  const exportedAt = new Date().toISOString()
  exportFile(
    `financeproject-backup-${dateInputValue(new Date())}.json`,
    JSON.stringify({ exportedAt, schema: 'financeproject-v1', data }, null, 2),
    'application/json;charset=utf-8',
  )
}

export function downloadDataCsv(data: HealthData) {
  const headers = ['table', 'id', 'label', 'amount', 'status', 'date', 'json']
  const rows = exportTables.flatMap(({ key, table }) =>
    data[key].map((item) => {
      const row = item as unknown as Record<string, unknown>
      return [
        table,
        row.id ?? '',
        exportRowLabel(row),
        exportRowAmount(row),
        row.status ?? row.card_type ?? row.category ?? '',
        exportRowDate(row),
        JSON.stringify(row),
      ]
    }),
  )

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  exportFile(`financeproject-backup-${dateInputValue(new Date())}.csv`, csv, 'text/csv;charset=utf-8')
}

export async function captureUndoRows(table: UndoTable, ids: string[]): Promise<UndoEntry | null> {
  const uniqueIds = compactIds(ids)
  if (uniqueIds.length === 0) return null

  const result = await fetchUndoRows(table, uniqueIds)
  if (!result.ok) throw new Error(result.error.message ?? 'Geri alma satırları yüklenemedi.')

  return { action: 'restoreRows', table, rows: result.data }
}

async function restoreUndoRows(table: UndoTable, rows: UndoRow[]) {
  if (rows.length === 0) return
  const result = await restoreUndoRepositoryRows(table, rows)
  if (!result.ok) throw new Error(result.error.message ?? 'Geri alma satırları geri yüklenemedi.')
}

async function deleteUndoRows(table: UndoTable, ids: string[]) {
  const uniqueIds = compactIds(ids)
  if (uniqueIds.length === 0) return

  if (table === 'card_installments') {
    const result = await deleteDataHealthRows(table, uniqueIds)
    if (!result.ok) throw new Error(result.error.message ?? 'Geri alma satırları silinemedi.')
    return
  }

  throw new Error('Bu tablo için geri alma silme adımı tanımlı değil.')
}

export async function applyUndoEntry(entry: UndoEntry) {
  if (entry.action === 'restoreRows') {
    await restoreUndoRows(entry.table, entry.rows)
    return
  }

  await deleteUndoRows(entry.table, entry.ids)
}
