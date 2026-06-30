/**
 * Bir harcama tarihinin hangi ekstre dönemine düştüğünü ve o ekstrenin son
 * ödeme gününü hesaplar.
 *
 * Dönem mantığı: harcama, statement_day'i geçmişse bir sonraki ayın ekstresine
 * girer. Son ödeme günü (due_day) ekstre gününden küçük/eşitse bir sonraki aya
 * taşar (due_day <= statement_day → +1 ay). `getNextCardPaymentDueDate` ise
 * obligations.ts'in kart borcu projeksiyonunda "bir sonraki ödeme günü" için kullanılır.
 */
import type { Card } from '../types/database'
import { addDays, dateInMonth, dateInputValue, startOfDay } from './date'

export type CardStatementPeriod = {
  periodStart: string
  periodEnd: string
  statementDate: string
  dueDate: string
  periodLabel: string
  statementMonthLabel: string
}

type StatementCard = Pick<Card, 'card_type' | 'statement_day' | 'due_day'>

function safeDate(value: Date | string | null | undefined) {
  if (value instanceof Date) return startOfDay(value)
  if (typeof value === 'string' && value) {
    const parsed = new Date(`${value}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) return startOfDay(parsed)
  }
  return startOfDay(new Date())
}

function shortDate(value: Date) {
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(value)
}

function monthLabel(value: Date) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(value)
}

export function getCardStatementPeriod(
  card: StatementCard | null | undefined,
  transactionDate: Date | string | null | undefined = new Date(),
): CardStatementPeriod | null {
  if (card?.card_type !== 'kredi_karti' || !card.statement_day || !card.due_day) return null

  const spentAt = safeDate(transactionDate)
  const statementThisMonth = dateInMonth(spentAt.getFullYear(), spentAt.getMonth(), card.statement_day)
  const statementDate =
    spentAt <= statementThisMonth
      ? statementThisMonth
      : dateInMonth(spentAt.getFullYear(), spentAt.getMonth() + 1, card.statement_day)
  const previousStatementDate = dateInMonth(statementDate.getFullYear(), statementDate.getMonth() - 1, card.statement_day)
  const periodStart = addDays(previousStatementDate, 1)
  const dueDate = dateInMonth(
    statementDate.getFullYear(),
    statementDate.getMonth() + (card.due_day <= card.statement_day ? 1 : 0),
    card.due_day,
  )

  return {
    periodStart: dateInputValue(periodStart),
    periodEnd: dateInputValue(statementDate),
    statementDate: dateInputValue(statementDate),
    dueDate: dateInputValue(dueDate),
    periodLabel: `${shortDate(periodStart)} - ${shortDate(statementDate)}`,
    statementMonthLabel: monthLabel(statementDate),
  }
}

export function getNextCardPaymentDueDate(card: StatementCard | null | undefined, from: Date | string | null | undefined = new Date()) {
  if (card?.card_type !== 'kredi_karti' || !card.due_day) return null

  const baseDate = safeDate(from)
  const dueThisMonth = dateInMonth(baseDate.getFullYear(), baseDate.getMonth(), card.due_day)
  const dueDate = dueThisMonth >= baseDate ? dueThisMonth : dateInMonth(baseDate.getFullYear(), baseDate.getMonth() + 1, card.due_day)
  return dateInputValue(dueDate)
}
