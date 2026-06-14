import {
  deleteDataHealthRows,
  insertCardInstallments,
  updateDataHealthRow,
  updateDataHealthRows,
} from '../data/repositories/dataHealthRepo'
import type { InsertFor, UpdateFor } from '../types/database'
import { recomputeAccountBalance } from '../services/accountLedgerActions'
import { recomputeCardDebt } from '../services/cardLedgerActions'
import { roundMoney } from '../utils/financeSummary'
import {
  addMonthsToMonthStart,
  captureUndoRows,
  currentMonthStart,
  makeUndoBatch,
  type HealthIssue,
  type UndoBatch,
  type UndoEntry,
  type UndoTable,
} from './DataHealth.logic'

export async function fixIssue(issue: HealthIssue): Promise<UndoBatch | null> {
  const payload = issue.payload
  if (!payload) return null
  const undoEntries: UndoEntry[] = []
  const addUndo = async (table: UndoTable, ids: string[]) => {
    const entry = await captureUndoRows(table, ids)
    if (entry) undoEntries.push(entry)
  }

  if (issue.kind === 'assetShape' && payload.assetId && payload.updates) {
    await addUndo('assets', [payload.assetId])
    const updateError = await updateDataHealthRow('assets', payload.assetId, payload.updates as UpdateFor<'assets'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Varlık güncellenemedi.')
  }

  if (issue.kind === 'budgetMonth' && payload.budgetId && payload.updates) {
    await addUndo('budgets', [payload.budgetId])
    const updateError = await updateDataHealthRow('budgets', payload.budgetId, payload.updates as UpdateFor<'budgets'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Bütçe güncellenemedi.')
  }

  if (issue.kind === 'cardDebtSplit' && payload.cardId) {
    await addUndo('cards', [payload.cardId])
    const updateError = await updateDataHealthRow('cards', payload.cardId, {
        statement_debt_amount: payload.statementDebt ?? 0,
        current_period_spending: payload.currentPeriod ?? 0,
        provision_amount: payload.provisionAmount ?? 0,
      })
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart borç kırılımı güncellenemedi.')
  }

  if (issue.kind === 'cardScheduledDebt' && payload.cardId && payload.nextDebtAmount !== undefined) {
    await addUndo('cards', [payload.cardId])
    const updateError = await updateDataHealthRow('cards', payload.cardId, {
        debt_amount: payload.nextDebtAmount,
      })
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart borcu güncellenemedi.')
  }

  if (issue.kind === 'cardLedgerDrift' && payload.cardId) {
    await addUndo('cards', [payload.cardId])
    const { error: rpcError } = await recomputeCardDebt(payload.cardId)
    if (rpcError) throw new Error(rpcError.message ?? 'Borç yeniden hesaplanamadı.')
  }

  if (issue.kind === 'accountLedgerDrift' && payload.cardId) {
    await addUndo('cards', [payload.cardId])
    const { error: rpcError } = await recomputeAccountBalance(payload.cardId)
    if (rpcError) throw new Error(rpcError.message ?? 'Bakiye yeniden hesaplanamadı.')
  }

  if (issue.kind === 'cardTypeFields' && payload.cardId && payload.updates) {
    await addUndo('cards', [payload.cardId])
    const updateError = await updateDataHealthRow('cards', payload.cardId, payload.updates as UpdateFor<'cards'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart alanları güncellenemedi.')
  }

  if (issue.kind === 'cardExpenseAmount' && payload.expenseId && payload.updates) {
    await addUndo('card_expenses', [payload.expenseId])
    const updateError = await updateDataHealthRow('card_expenses', payload.expenseId, payload.updates as UpdateFor<'card_expenses'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart harcaması güncellenemedi.')
  }

  if (issue.kind === 'cardSingleInstallments' && payload.ids?.length) {
    await addUndo('card_installments', payload.ids)
    const deleteError = await deleteDataHealthRows('card_installments', payload.ids)
    if (!deleteError.ok) throw new Error(deleteError.error.message ?? 'Kart taksitleri silinemedi.')
  }

  if ((issue.kind === 'cardInstallmentDueMonth' || issue.kind === 'cardInstallmentPostedAt' || issue.kind === 'cardInstallmentCount') && payload.ids?.length && payload.updates) {
    await addUndo('card_installments', payload.ids)
    const updateError = await updateDataHealthRows('card_installments', payload.ids, payload.updates as UpdateFor<'card_installments'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart taksitleri güncellenemedi.')
  }

  if (issue.kind === 'cardStatementTotals' && payload.statementArchiveId && payload.updates) {
    await addUndo('card_statement_archives', [payload.statementArchiveId])
    const updateError = await updateDataHealthRow(
      'card_statement_archives',
      payload.statementArchiveId,
      payload.updates as UpdateFor<'card_statement_archives'>,
    )
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Ekstre arşivi güncellenemedi.')
  }

  if (issue.kind === 'cardMissingInstallments' && payload.userId && payload.cardId && payload.cardExpenseId && payload.installmentNos && payload.baseMonth) {
    const rows: InsertFor<'card_installments'>[] = payload.installmentNos.map((installmentNo) => {
      const dueMonth = addMonthsToMonthStart(payload.baseMonth ?? currentMonthStart(), installmentNo - 1)
      const baseAmount = payload.amount ?? 0
      const installmentCount = payload.installmentCount ?? 1
      const amount =
        payload.totalAmount && installmentNo === installmentCount
          ? roundMoney(payload.totalAmount - baseAmount * (installmentCount - 1))
          : baseAmount

      return {
        user_id: payload.userId ?? '',
        card_id: payload.cardId ?? '',
        card_expense_id: payload.cardExpenseId ?? null,
        installment_no: installmentNo,
        installment_count: installmentCount,
        due_month: dueMonth,
        amount,
        description: payload.description ?? 'Taksit',
        category: payload.category ?? 'Diğer',
        status: 'scheduled',
        posted_at: null,
        paid_at: null,
        note: 'Veri sağlığı kontrolüyle tamamlandı.',
      }
    })

    const insertResult = await insertCardInstallments(rows)
    if (!insertResult.ok) throw new Error(insertResult.error.message ?? 'Eksik taksitler eklenemedi.')

    const insertedIds = insertResult.data
    if (insertedIds.length > 0) {
      undoEntries.push({ action: 'deleteRows', table: 'card_installments', ids: insertedIds })
    }
  }

  if (issue.kind === 'debtShape' && payload.debtId && payload.updates) {
    await addUndo('debts', [payload.debtId])
    const updateError = await updateDataHealthRow('debts', payload.debtId, payload.updates as UpdateFor<'debts'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Borç/alacak kaydı güncellenemedi.')
  }

  if (issue.kind === 'loanTotals' && payload.loanId) {
    await addUndo('loans', [payload.loanId])
    const updateError = await updateDataHealthRow('loans', payload.loanId, {
        remaining_amount: payload.remainingAmount ?? 0,
        remaining_installments: payload.remainingInstallments ?? 0,
        status: payload.loanStatus ?? 'active',
      })
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi özeti güncellenemedi.')
  }

  if (issue.kind === 'loanInstallmentDueDay' && payload.ids?.length && payload.updates) {
    await addUndo('loan_installments', payload.ids)
    const updateError = await updateDataHealthRows('loan_installments', payload.ids, payload.updates as UpdateFor<'loan_installments'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi taksitleri güncellenemedi.')
  }

  if (issue.kind === 'loanPaidAtMissing' && payload.ids?.length) {
    await addUndo('loan_installments', payload.ids)
    const updateError = await updateDataHealthRows('loan_installments', payload.ids, { paid_at: new Date().toISOString() })
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi taksitleri güncellenemedi.')
  }

  if (issue.kind === 'loanPendingPaidAt' && payload.ids?.length) {
    await addUndo('loan_installments', payload.ids)
    const updateError = await updateDataHealthRows('loan_installments', payload.ids, { paid_at: null })
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi taksitleri güncellenemedi.')
  }

  if (issue.kind === 'paymentDueDay' && payload.paymentId && payload.dueDate) {
    await addUndo('payments', [payload.paymentId])
    const updateError = await updateDataHealthRow('payments', payload.paymentId, { due_date: payload.dueDate })
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Ödeme tarihi güncellenemedi.')
  }

  if (issue.kind === 'paymentRecurrenceFields' && payload.paymentId && payload.updates) {
    await addUndo('payments', [payload.paymentId])
    const updateError = await updateDataHealthRow('payments', payload.paymentId, payload.updates as UpdateFor<'payments'>)
    if (!updateError.ok) throw new Error(updateError.error.message ?? 'Planlı ödeme güncellenemedi.')
  }

  return makeUndoBatch(issue.title, undoEntries)
}
