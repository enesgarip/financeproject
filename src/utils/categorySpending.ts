import type { Card, CardExpense, CardInstallment, CardStatementArchive } from '../types/database'
import { getCardStatementPeriod } from './cardStatement'
import { addDays, dateInputValue, endOfMonth } from './date'
import { equalsTL, sumTL } from './money'

export type CategoryHistory = {
  expenses: Pick<CardExpense, 'id' | 'card_id' | 'statement_archive_id' | 'spent_at' | 'amount' | 'description' | 'category' | 'installment_count' | 'status'>[]
  installments: Pick<CardInstallment, 'id' | 'card_id' | 'card_expense_id' | 'statement_archive_id' | 'due_month' | 'amount' | 'description' | 'category' | 'installment_no' | 'installment_count' | 'status'>[]
  statements: Pick<CardStatementArchive, 'id' | 'card_id' | 'statement_date' | 'statement_debt_amount'>[]
}
export type CategorySelection = { mode: 'statement' | 'calendar'; cardId: string; period: string }
export type CategoryTransaction = { id: string; cardId: string; archiveId: string | null; date: string; description: string; amount: number; category: string; installment: string | null }
export type CategoryPeriod = { cardId: string; start: string | null; end: string; statementId: string | null }

export function categoryMonthLabel(key: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${key}-01T00:00:00`))
}

export function categoryPeriodOptions(history: CategoryHistory, selection: Pick<CategorySelection, 'mode' | 'cardId'>, today = new Date()) {
  const matches = (cardId: string) => selection.cardId === 'all' || selection.cardId === cardId
  const months = new Set<string>()
  if (selection.mode === 'statement') {
    history.statements.filter(row => matches(row.card_id) && row.statement_date <= dateInputValue(today)).forEach(row => months.add(row.statement_date.slice(0, 7)))
  } else {
    months.add(dateInputValue(today).slice(0, 7))
    history.expenses.filter(row => matches(row.card_id) && row.status === 'posted' && row.spent_at <= dateInputValue(today)).forEach(row => months.add(row.spent_at.slice(0, 7)))
  }
  return [...months].sort().reverse()
}

/** Arşiv bağı geçmiş için kanıttır; bugünkü kesim gününden geçmiş bağlantı uydurulmaz.
 * Ekstrede taksit çocukları, takvim ayında alışverişin toplamı sayılır. */
export function buildCategorySpending(cards: Card[], history: CategoryHistory, selection: CategorySelection, today = new Date()) {
  const todayKey = dateInputValue(today)
  const selectedCards = cards.filter(card => (selection.cardId === 'all' || card.id === selection.cardId) && (selection.mode === 'calendar' || card.card_type === 'kredi_karti'))
  const cardIds = new Set(selectedCards.map(card => card.id))
  const periods: CategoryPeriod[] = []
  const warnings: string[] = []
  const transactions: CategoryTransaction[] = []
  if (selection.mode === 'statement') {
    for (const card of selectedCards) {
      const archives = history.statements.filter(row => row.card_id === card.id && row.statement_date <= todayKey).sort((a, b) => a.statement_date.localeCompare(b.statement_date))
      if (selection.period !== 'current') {
        const matching = archives.filter(row => row.statement_date.slice(0, 7) === selection.period)
        if (!matching.length) warnings.push(`${card.card_name}: bu ay için kayıtlı ekstre yok.`)
        for (const archive of matching) {
          const previous = archives.filter(row => row.statement_date < archive.statement_date).at(-1)
          periods.push({ cardId: card.id, start: previous ? dateInputValue(addDays(new Date(`${previous.statement_date}T00:00:00`), 1)) : null, end: archive.statement_date, statementId: archive.id })
        }
        continue
      }
      // Harcama dönemi vade gününe bağlı değildir; ortak helper yalnız kesim için kullanılır.
      const current = getCardStatementPeriod({ ...card, due_day: card.due_day ?? card.statement_day }, today)
      if (!current) {
        warnings.push(`${card.card_name}: hesap kesim günü eksik; toplama dahil edilmedi.`)
        continue
      }
      const latest = archives.at(-1)
      // Kesim bugün zaten gerçekleşmişse aynı gün ikinci kez eski dönemi açma.
      const next = latest?.statement_date === current.statementDate
        ? getCardStatementPeriod({ ...card, due_day: card.due_day ?? card.statement_day }, addDays(today, 1))!
        : current
      const start = latest && latest.statement_date >= next.periodStart
        ? dateInputValue(addDays(new Date(`${latest.statement_date}T00:00:00`), 1)) : next.periodStart
      periods.push({ cardId: card.id, start, end: next.periodEnd, statementId: null })
    }
  }
  const includes = (cardId: string, archiveId: string | null, date: string) => periods.some(period => period.cardId === cardId && (
    period.statementId ? archiveId === period.statementId : !archiveId && date >= period.start! && date <= period.end && date <= todayKey
  ))
  for (const expense of history.expenses) {
    if (!cardIds.has(expense.card_id) || expense.status !== 'posted') continue
    if (selection.mode === 'calendar') {
      if (expense.spent_at.slice(0, 7) !== selection.period || expense.spent_at > todayKey) continue
    } else if (expense.installment_count > 1 || !includes(expense.card_id, expense.statement_archive_id, expense.spent_at)) continue
    transactions.push({ id: `expense:${expense.id}`, cardId: expense.card_id, archiveId: expense.statement_archive_id, date: expense.spent_at, description: expense.description, amount: expense.amount, category: expense.category || 'Diğer', installment: null })
  }
  if (selection.mode === 'statement') {
    const parents = new Map(history.expenses.map(row => [row.id, row]))
    for (const row of history.installments) {
      if (!cardIds.has(row.card_id) || row.status === 'scheduled' || (row.card_expense_id && parents.get(row.card_expense_id)?.status === 'cancelled')) continue
      if (!includes(row.card_id, row.statement_archive_id, row.due_month)) continue
      transactions.push({ id: `installment:${row.id}`, cardId: row.card_id, archiveId: row.statement_archive_id, date: row.due_month, description: row.description, amount: row.amount, category: row.category || 'Diğer', installment: `${row.installment_no}/${row.installment_count} taksit` })
    }
    // Banka toplamı ile kategori kaydı farklı kaynaklardır; kalan tutara kategori uydurma.
    for (const period of periods.filter(row => row.statementId)) {
      const archive = history.statements.find(row => row.id === period.statementId)!
      const recorded = sumTL(transactions.filter(row => row.archiveId === archive.id).map(row => row.amount))
      if (!equalsTL(recorded, archive.statement_debt_amount)) warnings.push(`${selectedCards.find(card => card.id === period.cardId)!.card_name}: kategori kayıtları ekstre tutarının tamamını temsil etmeyebilir; faiz, iade ve düzeltmeler farklı olabilir.`)
    }
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  const grouped = new Map<string, CategoryTransaction[]>()
  for (const row of transactions) {
    const rows = grouped.get(row.category) ?? []
    rows.push(row)
    grouped.set(row.category, rows)
  }
  const total = sumTL(transactions.map(row => row.amount))
  const categories = [...grouped].map(([category, rows]) => ({ category, amount: sumTL(rows.map(row => row.amount)), rows })).sort((a, b) => b.amount - a.amount)
  return { total, categories, periods, warnings }
}

export function calendarPeriodRange(month: string) {
  return { start: `${month}-01`, end: dateInputValue(endOfMonth(new Date(`${month}-01T00:00:00`))) }
}
