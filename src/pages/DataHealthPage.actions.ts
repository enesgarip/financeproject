import {
  updateDataHealthRow,
} from '../data/repositories/dataHealthRepo'
import type { UpdateFor } from '../types/database'
import { postDueCardInstallments } from '../data/repositories/financeSnapshotRepo'
import {
  applyDataHealthSafeRepairs,
  type DataHealthSafeRepair,
} from '../services/dataHealthRepairs'
import {
  type HealthIssue,
  type UndoBatch,
  type UndoEntry,
  type UndoTable,
} from './DataHealth.logic'
import { captureUndoRows, makeUndoBatch } from './DataHealth.actions'
import { resolveHealthIssue } from './DataHealth.resolution'

export const MAX_SAFE_REPAIR_BATCH_SIZE = 100

export function safeRepairForIssue(issue: HealthIssue): DataHealthSafeRepair | null {
  const payload = issue.payload
  const expectedUpdatedAt = payload?.expectedUpdatedAt
  if (!payload || !expectedUpdatedAt) return null

  if ((issue.kind === 'cardLedgerDrift' || issue.kind === 'cardSplitDrift') && payload.cardId) {
    return { rule: 'card_ledger_recompute', targetId: payload.cardId, expectedUpdatedAt }
  }

  if (issue.kind === 'accountLedgerDrift' && payload.cardId) {
    return { rule: 'account_ledger_recompute', targetId: payload.cardId, expectedUpdatedAt }
  }

  if (issue.kind === 'loanTotals' && payload.loanId) {
    return { rule: 'loan_summary_recompute', targetId: payload.loanId, expectedUpdatedAt }
  }

  if (issue.kind === 'cardDebtSplit' && issue.id.startsWith('card-split-') && payload.cardId) {
    return { rule: 'card_split_clamp', targetId: payload.cardId, expectedUpdatedAt }
  }

  return null
}

export function safeRepairPlanForIssues(issues: HealthIssue[]): DataHealthSafeRepair[] {
  const repairs = new Map<string, DataHealthSafeRepair>()

  for (const issue of issues) {
    const resolution = resolveHealthIssue(issue)
    if (!resolution.bulkEligible) continue

    const repair = safeRepairForIssue(issue)
    if (!repair) {
      throw new Error(`Toplu çözüm politikası için yürütücü eksik: ${issue.id}`)
    }

    repairs.set(`${repair.rule}:${repair.targetId}`, repair)
  }

  return [...repairs.values()].sort(
    (left, right) => left.targetId.localeCompare(right.targetId) || left.rule.localeCompare(right.rule),
  )
}

export function safeRepairBatchForIssues(issues: HealthIssue[]) {
  const fullPlan = safeRepairPlanForIssues(issues)
  const repairs = fullPlan.slice(0, MAX_SAFE_REPAIR_BATCH_SIZE)
  const selectedKeys = new Set(
    repairs.map((repair) => `${repair.rule}:${repair.targetId}`),
  )
  const selectedIssues = issues.filter((issue) => {
    if (!resolveHealthIssue(issue).bulkEligible) return false
    const repair = safeRepairForIssue(issue)
    return repair ? selectedKeys.has(`${repair.rule}:${repair.targetId}`) : false
  })

  return {
    repairs,
    issues: selectedIssues,
    remainingRepairCount: fullPlan.length - repairs.length,
  }
}

function repairFailureMessage(status: 'conflict' | 'failed', message: string | null) {
  if (status === 'conflict') {
    return 'Kayıt kontrol sonrasında değişti. Hiçbir düzeltme uygulanmadı; veriyi yenileyip tekrar dene.'
  }
  return message ?? 'Güvenli düzeltme sunucuda tamamlanamadı.'
}

async function applySafeRepair(repair: DataHealthSafeRepair) {
  const result = await applyDataHealthSafeRepairs([repair])
  if (result.error) throw new Error(result.error.message ?? 'Güvenli düzeltme uygulanamadı.')
  if (!result.receipt) throw new Error('Güvenli düzeltme sonucu alınamadı.')
  if (result.receipt.status === 'running') {
    throw new Error('Aynı güvenli düzeltme hâlâ sunucuda çalışıyor; sonucu görmek için veriyi yenile.')
  }
  if (result.receipt.status === 'conflict' || result.receipt.status === 'failed') {
    throw new Error(repairFailureMessage(result.receipt.status, result.receipt.message))
  }
}

export async function fixIssue(issue: HealthIssue): Promise<UndoBatch | null> {
  const resolution = resolveHealthIssue(issue)
  if (resolution.primaryAction !== 'fix') {
    throw new Error('Bu bulgu otomatik yazmayla değil, ilgili inceleme akışında çözülmelidir.')
  }

  const safeRepair = safeRepairForIssue(issue)
  if (safeRepair) {
    await applySafeRepair(safeRepair)
    return null
  }

  if (issue.kind === 'manual' && issue.id.startsWith('card-scheduled-')) {
    const result = await postDueCardInstallments()
    if (!result.ok) throw new Error(result.error.message ?? 'Kart taksit bakımı çalıştırılamadı.')
    return null
  }

  if (resolution.mode !== 'guarded_one_click' || !issue.fixable) {
    throw new Error('Bu bulgu mevcut haliyle tek tıkla güvenli biçimde düzeltilemez.')
  }

  const payload = issue.payload
  if (!payload) throw new Error('Düzeltme için gerekli hedef bilgisi bulunamadı.')
  const undoEntries: UndoEntry[] = []
  let handled = false
  const captureUndo = async (table: UndoTable, id: string) => {
    const entry = await captureUndoRows(table, [id])
    if (
      !entry
      || entry.action !== 'restoreRows'
      || entry.rows.length !== 1
      || entry.rows[0]?.id !== id
    ) {
      throw new Error('Geri alma anlık görüntüsü güvenli biçimde oluşturulamadı; düzeltme uygulanmadı.')
    }
    return entry
  }
  const addUndo = (
    entry: Extract<UndoEntry, { action: 'restoreRows' }>,
    id: string,
    updates: object,
    updatedAt: string,
  ) => {
    const fields = Object.keys(updates)
    if (fields.length === 0) return
    undoEntries.push({
      ...entry,
      fields,
      expectedUpdatedAtById: { [id]: updatedAt },
    })
  }

  if (issue.kind === 'assetShape' && payload.assetId && payload.updates && payload.expectedUpdatedAt) {
    handled = true
    const updates = payload.updates as UpdateFor<'assets'>
    const undoEntry = await captureUndo('assets', payload.assetId)
    const updateError = await updateDataHealthRow(
      'assets',
      payload.assetId,
      updates,
      payload.expectedUpdatedAt,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Varlık güncellenemedi.')
    addUndo(undoEntry, payload.assetId, updates, updateError.data.updatedAt)
  }

  if (issue.kind === 'budgetMonth' && payload.budgetId && payload.updates && payload.expectedUpdatedAt) {
    handled = true
    const updates = payload.updates as UpdateFor<'budgets'>
    const undoEntry = await captureUndo('budgets', payload.budgetId)
    const updateError = await updateDataHealthRow(
      'budgets',
      payload.budgetId,
      updates,
      payload.expectedUpdatedAt,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Bütçe güncellenemedi.')
    addUndo(undoEntry, payload.budgetId, updates, updateError.data.updatedAt)
  }

  if (issue.kind === 'cardTypeFields' && payload.cardId && payload.updates && payload.expectedUpdatedAt) {
    handled = true
    const updates = payload.updates as UpdateFor<'cards'>
    const undoEntry = await captureUndo('cards', payload.cardId)
    const updateError = await updateDataHealthRow(
      'cards',
      payload.cardId,
      updates,
      payload.expectedUpdatedAt,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart alanları güncellenemedi.')
    addUndo(undoEntry, payload.cardId, updates, updateError.data.updatedAt)
  }

  if (issue.kind === 'debtShape' && payload.debtId && payload.updates && payload.expectedUpdatedAt) {
    handled = true
    const updates = payload.updates as UpdateFor<'debts'>
    const undoEntry = await captureUndo('debts', payload.debtId)
    const updateError = await updateDataHealthRow(
      'debts',
      payload.debtId,
      updates,
      payload.expectedUpdatedAt,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Borç/alacak kaydı güncellenemedi.')
    addUndo(undoEntry, payload.debtId, updates, updateError.data.updatedAt)
  }

  if (issue.kind === 'paymentDueDay' && payload.paymentId && payload.dueDate && payload.expectedUpdatedAt) {
    handled = true
    const updates: UpdateFor<'payments'> = { due_date: payload.dueDate }
    const undoEntry = await captureUndo('payments', payload.paymentId)
    const updateError = await updateDataHealthRow(
      'payments',
      payload.paymentId,
      updates,
      payload.expectedUpdatedAt,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Ödeme tarihi güncellenemedi.')
    addUndo(undoEntry, payload.paymentId, updates, updateError.data.updatedAt)
  }

  if (issue.kind === 'paymentRecurrenceFields' && payload.paymentId && payload.updates && payload.expectedUpdatedAt) {
    handled = true
    const updates = payload.updates as UpdateFor<'payments'>
    const undoEntry = await captureUndo('payments', payload.paymentId)
    const updateError = await updateDataHealthRow(
      'payments',
      payload.paymentId,
      updates,
      payload.expectedUpdatedAt,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Planlı ödeme güncellenemedi.')
    addUndo(undoEntry, payload.paymentId, updates, updateError.data.updatedAt)
  }

  if (!handled) {
    throw new Error('Bu bulgu için güvenli bir yürütücü tanımlı değil.')
  }

  return makeUndoBatch(issue.title, undoEntries)
}
