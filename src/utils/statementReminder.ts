import type { Card, CardStatementArchive } from '../types/database'
import { dateInputValue, formatDate, nextMonthlyDate } from './date'
import { formatCurrency } from './formatCurrency'
import { daysUntilFrom, nextUncutStatementDate } from './statementCycle'

export type StatementReminder = {
  cardId: string
  cardLabel: string
  kind: 'upcoming' | 'ready'
  statementDate: Date
  daysUntilStatement: number
  currentPeriodSpending: number
  dueDay: number | null
  dueDateLabel: string
}

export function buildStatementReminders(cards: Card[], statements: CardStatementArchive[] = [], from = new Date()): StatementReminder[] {
  const reminders: StatementReminder[] = []

  for (const card of cards) {
    if (card.card_type !== 'kredi_karti' || !card.statement_day) continue

    const cardLabel = `${card.bank_name} · ${card.card_name}`
    const statementDate = nextUncutStatementDate(card, statements, from)
    if (!statementDate) continue

    const dueDate = card.due_day ? nextMonthlyDate(card.due_day) : null
    const remaining = daysUntilFrom(statementDate, from)

    if (card.current_period_spending > 0 && remaining <= 0) {
      reminders.push({
        cardId: card.id,
        cardLabel,
        kind: 'ready',
        statementDate,
        daysUntilStatement: remaining,
        currentPeriodSpending: card.current_period_spending,
        dueDay: card.due_day,
        dueDateLabel: dueDate ? formatDate(dateInputValue(dueDate)) : '-',
      })
      continue
    }

    if (card.current_period_spending > 0 && remaining > 0 && remaining <= 3) {
      reminders.push({
        cardId: card.id,
        cardLabel,
        kind: 'upcoming',
        statementDate,
        daysUntilStatement: remaining,
        currentPeriodSpending: card.current_period_spending,
        dueDay: card.due_day,
        dueDateLabel: dueDate ? formatDate(dateInputValue(dueDate)) : '-',
      })
    }
  }

  return reminders.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'ready' ? -1 : 1
    return a.daysUntilStatement - b.daysUntilStatement
  })
}

export function statementReminderTitle(reminder: StatementReminder) {
  if (reminder.kind === 'ready') {
    return `${reminder.cardLabel} ekstresi kesilebilir`
  }

  if (reminder.daysUntilStatement === 0) {
    return `${reminder.cardLabel} ekstre günü bugün`
  }

  return `${reminder.cardLabel} ekstresi ${reminder.daysUntilStatement} gün sonra`
}

export function statementReminderDescription(reminder: StatementReminder) {
  const period = `Dönem içi: ${formatCurrency(reminder.currentPeriodSpending)}`
  if (reminder.kind === 'ready') {
    return `${period}. Kesince ekstre borcuna aktarılır.`
  }

  return `${period}. ${formatDate(dateInputValue(reminder.statementDate))} tarihinde ekstre kesilir.`
}
