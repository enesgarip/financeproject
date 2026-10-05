import type { CardExpense, CardStatementArchive } from '../types/database'

/**
 * Kesilmiş açık ekstrenin döneminde kalmış bir provizyon artık elle
 * kesinleştirilemez. Aksi halde post_card_provision onu yeni döneme taşır;
 * doğru onarım, PDF kaynak gerçeğiyle ekstreyi yeniden kurmaktır.
 */
export function statementAwaitingProvision(
  expense: Pick<CardExpense, 'card_id' | 'spent_at'>,
  statements: ReadonlyArray<Pick<CardStatementArchive, 'card_id' | 'statement_date' | 'status'>>,
) {
  const spentAt = expense.spent_at.slice(0, 10)
  return statements
    .filter((statement) =>
      statement.card_id === expense.card_id
      && statement.status === 'open'
      && statement.statement_date.slice(0, 10) >= spentAt,
    )
    .sort((left, right) => right.statement_date.localeCompare(left.statement_date))[0] ?? null
}
