import type { CardExpense, CardStatementArchive } from '../types/database'
import { equalsTL, toKurus } from './money'
import { descriptionsProveDistinct, normalizedTransactionDescription } from './transactionFingerprint'

export type StatementExpenseEvidence = Pick<CardExpense,
  'id' | 'user_id' | 'card_id' | 'created_at' | 'current_settlement_id' | 'statement_archive_id'
  | 'source' | 'spent_at' | 'amount' | 'description' | 'installment_count' | 'status'>

export type StatementArchiveEvidence = Pick<CardStatementArchive,
  'id' | 'user_id' | 'card_id' | 'statement_date' | 'statement_debt_amount' | 'reconciled_bank_amount' | 'status'>

export function isBankMatchedStatement(archive: StatementArchiveEvidence, expense: Pick<CardExpense, 'user_id' | 'card_id'>) {
  return archive.user_id === expense.user_id && archive.card_id === expense.card_id
    && (archive.status === 'open' || archive.status === 'paid')
    && archive.reconciled_bank_amount != null && equalsTL(archive.statement_debt_amount, archive.reconciled_bank_amount)
}

function sameMerchant(sms: StatementExpenseEvidence, pdf: StatementExpenseEvidence) {
  const smsDescription = normalizedTransactionDescription(sms.description)
  const pdfDescription = normalizedTransactionDescription(pdf.description)
  // PDF satıcının unvanını kısaltabilir. Tek kelimeyi veya yalnız token
  // benzerliğini eşleşme sayma.
  return pdfDescription.includes(' ') && !descriptionsProveDistinct(sms.description, pdf.description)
    && (smsDescription === pdfDescription || smsDescription.startsWith(`${pdfDescription} `))
}

/** Ödenmiş dönem içi SMS kaydının ekstredeki karşılığını bulur. Eşit tutarlı
 * ikinci bir aday varsa hiçbir satırı sayımdan çıkarmaz. */
export function settledSmsCopiesInStatement(
  expenses: readonly StatementExpenseEvidence[],
  statements: readonly StatementArchiveEvidence[],
): Set<string> {
  const groups = new Map<string, StatementExpenseEvidence[]>()
  for (const expense of expenses) {
    if (expense.status !== 'posted' || expense.amount <= 0) continue
    const key = JSON.stringify([expense.user_id, expense.card_id, expense.spent_at, toKurus(expense.amount)])
    const group = groups.get(key)
    if (group) group.push(expense)
    else groups.set(key, [expense])
  }

  const archives = new Map(statements.map((row) => [row.id, row]))
  const copies = new Set<string>()
  for (const group of groups.values()) {
    if (group.length !== 2) continue
    const sms = group.find((row) => row.source === 'sms')
    const pdf = group.find((row) => row.source === 'statement_import')
    if (!sms?.current_settlement_id || sms.statement_archive_id || !pdf?.statement_archive_id || pdf.current_settlement_id
      || sms.installment_count !== 1 || pdf.installment_count !== 1
      || !(Date.parse(sms.created_at) < Date.parse(pdf.created_at))) continue

    const archive = archives.get(pdf.statement_archive_id)
    if (archive && sms.spent_at <= archive.statement_date && isBankMatchedStatement(archive, pdf) && sameMerchant(sms, pdf)) {
      copies.add(sms.id)
    }
  }
  return copies
}
