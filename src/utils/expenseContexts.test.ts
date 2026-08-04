import { describe, expect, it } from 'vitest'
import type { CardExpense, ContextExpense, ExpenseContext, ExpenseContextKind } from '../types/database'
import {
  EXPENSE_CONTEXT_KINDS,
  buildExpenseContextSummaries,
  contextCategories,
  contextKindTimeboxed,
} from './expenseContexts'

const context: ExpenseContext = {
  id: 'ctx1', user_id: 'u1', created_at: '', updated_at: '', kind: 'project', name: 'Taşınma',
  budget_amount: 10_000, starts_on: '2026-08-01', ends_on: '2026-09-01', sort_order: 0, note: null,
}
const manual: ContextExpense = {
  id: 'm1', user_id: 'u1', created_at: '', updated_at: '', context_id: 'ctx1', spent_at: '2026-08-02',
  amount: 2500, category: 'Hizmet', payment_method: 'nakit', description: 'Nakliye', note: null,
}
const card = {
  id: 'c1', user_id: 'u1', created_at: '', updated_at: '', context_id: 'ctx1', spent_at: '2026-08-03',
  amount: 1500, category: 'Malzeme', description: 'Koli', status: 'posted',
} as CardExpense

describe('buildExpenseContextSummaries', () => {
  it('kart ve manuel gideri çift saymadan toplar, bütçe burn-down üretir', () => {
    const result = buildExpenseContextSummaries([context], [manual], [card], new Date('2026-08-04'))[0]
    expect(result.total).toBe(4000)
    expect(result.thisMonthTotal).toBe(4000)
    expect(result.remainingBudget).toBe(6000)
    expect(result.budgetUsedRatio).toBe(0.4)
    expect(result.entries.map((entry) => entry.source).sort()).toEqual(['card', 'manual'])
  })
})

describe('bağlam tür registry', () => {
  it('altı türü kapsar ve her türün boş olmayan kategori seti vardır', () => {
    const kinds = EXPENSE_CONTEXT_KINDS.map((entry) => entry.kind)
    expect(kinds).toEqual(['pet', 'health', 'hobby', 'business', 'travel', 'project'])
    for (const entry of EXPENSE_CONTEXT_KINDS) {
      expect(entry.categories.length).toBeGreaterThan(0)
      expect(contextCategories(entry.kind)).toBe(entry.categories)
    }
  })

  it('süresiz/süreli eşlemesi doğru (yalnız travel + project tarihlidir)', () => {
    const timeboxed: ExpenseContextKind[] = ['travel', 'project']
    for (const entry of EXPENSE_CONTEXT_KINDS) {
      expect(contextKindTimeboxed(entry.kind)).toBe(timeboxed.includes(entry.kind))
    }
  })
})
