import type { CardExpense, ContextExpense, ExpenseContext } from '../types/database'
import { roundTL, sumTL } from './money'

export const PET_EXPENSE_CATEGORIES = ['Mama', 'Veteriner', 'Aşı', 'Bakım', 'İlaç', 'Oyuncak', 'Diğer'] as const
export const PROJECT_EXPENSE_CATEGORIES = ['Mekân', 'Ulaşım', 'Hizmet', 'Malzeme', 'Alışveriş', 'Diğer'] as const

export type ContextLedgerEntry = {
  id: string
  contextId: string
  source: 'card' | 'manual'
  spentAt: string
  amount: number
  category: string
  description: string
  paymentLabel: 'Kart' | 'Nakit' | 'Banka' | 'Diğer'
}

export type ExpenseContextSummary = {
  context: ExpenseContext
  total: number
  thisMonthTotal: number
  remainingBudget: number | null
  budgetUsedRatio: number | null
  entries: ContextLedgerEntry[]
}

export function buildContextEntries(manual: ContextExpense[], taggedCard: CardExpense[]): ContextLedgerEntry[] {
  const entries: ContextLedgerEntry[] = manual.map((row) => ({
    id: `manual:${row.id}`,
    contextId: row.context_id,
    source: 'manual',
    spentAt: row.spent_at,
    amount: roundTL(row.amount),
    category: row.category || 'Diğer',
    description: row.description.trim() || row.category || 'Gider',
    paymentLabel: row.payment_method === 'nakit' ? 'Nakit' : row.payment_method === 'banka' ? 'Banka' : 'Diğer',
  }))

  for (const row of taggedCard) {
    if (!row.context_id) continue
    entries.push({
      id: `card:${row.id}`,
      contextId: row.context_id,
      source: 'card',
      spentAt: row.spent_at,
      amount: roundTL(row.amount),
      category: row.category || 'Diğer',
      description: row.description.trim() || row.category || 'Kart harcaması',
      paymentLabel: 'Kart',
    })
  }
  return entries.sort((a, b) => b.spentAt.localeCompare(a.spentAt))
}

export function buildExpenseContextSummaries(
  contexts: ExpenseContext[],
  manual: ContextExpense[],
  taggedCard: CardExpense[],
  today: Date = new Date(),
): ExpenseContextSummary[] {
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const entries = buildContextEntries(manual, taggedCard)
  return contexts.map((context) => {
    const ownEntries = entries.filter((entry) => entry.contextId === context.id)
    const total = sumTL(ownEntries.map((entry) => entry.amount))
    const budget = context.budget_amount
    return {
      context,
      total,
      thisMonthTotal: sumTL(ownEntries.filter((entry) => entry.spentAt.startsWith(currentMonth)).map((entry) => entry.amount)),
      remainingBudget: budget == null ? null : roundTL(budget - total),
      budgetUsedRatio: budget == null || budget === 0 ? null : total / budget,
      entries: ownEntries,
    }
  })
}
