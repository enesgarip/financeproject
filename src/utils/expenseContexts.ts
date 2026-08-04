import type { CardExpense, ContextExpense, ExpenseContext, ExpenseContextKind } from '../types/database'
import { roundTL, sumTL } from './money'

/**
 * Bağlam tür kaydı — tek kaynak. Her tür yalnız {etiket, kategori seti, süreli
 * mi} belirler; para modeline dokunmaz (bağlam saf raporlama merceğidir).
 * `timeboxed` süresiz/süreli davranışını yönetir: süreli türler tarih aralığı +
 * bütçe burn-down taşır, süresiz türler (pet gibi) tarih göstermez.
 * Yeni tür eklemek: buraya bir satır + DB CHECK'i genişleten migration + sayfada
 * ikon eşlemesi. Kod başka yerde tür ismini elle karşılaştırmaz.
 */
export type ExpenseContextKindConfig = {
  kind: ExpenseContextKind
  label: string
  timeboxed: boolean
  categories: readonly string[]
}

export const EXPENSE_CONTEXT_KINDS = [
  { kind: 'pet', label: 'Evcil hayvan', timeboxed: false, categories: ['Mama', 'Veteriner', 'Aşı', 'Bakım', 'İlaç', 'Oyuncak', 'Diğer'] },
  { kind: 'health', label: 'Sağlık', timeboxed: false, categories: ['Doktor', 'İlaç', 'Diş', 'Tahlil/Tetkik', 'Gözlük', 'Spor salonu', 'Diğer'] },
  { kind: 'hobby', label: 'Hobi', timeboxed: false, categories: ['Ekipman', 'Malzeme', 'Etkinlik', 'Abonelik', 'Diğer'] },
  { kind: 'business', label: 'Yan iş / İşletme', timeboxed: false, categories: ['Yazılım/Abonelik', 'Ekipman', 'Reklam', 'Komisyon', 'Kırtasiye', 'Diğer'] },
  { kind: 'travel', label: 'Seyahat / Tatil', timeboxed: true, categories: ['Ulaşım', 'Konaklama', 'Yeme-içme', 'Gezi/Aktivite', 'Hediye/Alışveriş', 'Diğer'] },
  { kind: 'project', label: 'Etkinlik / Proje', timeboxed: true, categories: ['Mekân', 'Ulaşım', 'Hizmet', 'Malzeme', 'Alışveriş', 'Diğer'] },
] as const satisfies readonly ExpenseContextKindConfig[]

const KIND_CONFIG = new Map<ExpenseContextKind, ExpenseContextKindConfig>(
  EXPENSE_CONTEXT_KINDS.map((entry) => [entry.kind, entry]),
)

export function contextKindConfig(kind: ExpenseContextKind): ExpenseContextKindConfig {
  return KIND_CONFIG.get(kind) ?? EXPENSE_CONTEXT_KINDS[0]
}

export function contextKindLabel(kind: ExpenseContextKind): string {
  return contextKindConfig(kind).label
}

export function contextCategories(kind: ExpenseContextKind): readonly string[] {
  return contextKindConfig(kind).categories
}

export function contextKindTimeboxed(kind: ExpenseContextKind): boolean {
  return contextKindConfig(kind).timeboxed
}

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
