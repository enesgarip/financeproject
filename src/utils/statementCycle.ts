/**
 * Ekstre kesim döngüsü zamanlaması: "bu kartın ekstresi ne zaman kesilir,
 * şimdi kesilebilir mi, bu dönem için arşiv var mı?"
 *
 * Kritik kural (bankalar gibi): ekstre, ekstre gününün ERTESİ günü kesilir —
 * ekstre gününün harcaması o ekstreye dahildir (bkz. canCutCurrentStatement).
 * Bu yüzden statementReminder.ts "kesiliyor" durumunu remaining < 0'da gösterir.
 * Saf zamanlama; gerçek kesim/yazma DB tarafında.
 */
import type { Card, CardStatementArchive } from '../types/database'
import { dateInMonth, startOfDay } from './date'

type StatementCard = Pick<Card, 'id' | 'card_type' | 'statement_day'>
type StatementCutCard = StatementCard & Pick<Card, 'current_period_spending'>

const DAY_IN_MS = 86_400_000

export function statementPeriodParts(month = new Date()) {
  return {
    year: month.getFullYear(),
    month: month.getMonth() + 1,
  }
}

export function hasStatementArchiveForPeriod(
  cardId: string,
  statements: CardStatementArchive[],
  month = new Date(),
) {
  const period = statementPeriodParts(month)
  return statements.some(
    (statement) =>
      statement.card_id === cardId &&
      statement.period_year === period.year &&
      statement.period_month === period.month,
  )
}

export function statementDateForMonth(card: Pick<Card, 'statement_day'>, month = new Date()) {
  if (!card.statement_day) return null
  return dateInMonth(month.getFullYear(), month.getMonth(), card.statement_day)
}

export function daysUntilFrom(value: Date, from = new Date()) {
  const target = startOfDay(value)
  const origin = startOfDay(from)
  return Math.ceil((target.getTime() - origin.getTime()) / DAY_IN_MS)
}

export function canCutCurrentStatement(
  card: StatementCutCard,
  statements: CardStatementArchive[] = [],
  from = new Date(),
) {
  if (card.card_type !== 'kredi_karti' || !card.statement_day || card.current_period_spending <= 0) {
    return false
  }

  // Cut the day AFTER the statement day (like banks): the statement day's own
  // spending belongs to that statement, so we only cut once the day is over.
  const statementDate = statementDateForMonth(card, from)
  if (!statementDate || startOfDay(from) <= statementDate) return false

  return !hasStatementArchiveForPeriod(card.id, statements, from)
}

export function nextUncutStatementDate(
  card: StatementCard,
  statements: CardStatementArchive[] = [],
  from = new Date(),
) {
  if (card.card_type !== 'kredi_karti' || !card.statement_day) return null

  if (hasStatementArchiveForPeriod(card.id, statements, from)) {
    return dateInMonth(from.getFullYear(), from.getMonth() + 1, card.statement_day)
  }

  return statementDateForMonth(card, from)
}
