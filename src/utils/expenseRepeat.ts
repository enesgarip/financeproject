/**
 * Son harcamalardan "tekrarla" önerileri (saf).
 *
 * Aynı harcamayı her ay/hafta elle girmemek için: son kayıtları açıklamaya göre
 * tekilleştirir (en yeni kalır), yalnız peşin (tek taksit) kesinleşmiş harcamaları
 * alır (taksit tekrarı ayrı bir akış). Açıklama tr-TR tuzağına düşmeden
 * normalizeDescription ile eşlenir.
 */
import type { CardExpense } from '../types/database'
import { normalizeDescription } from './categories'

export type RepeatSuggestion = {
  cardId: string
  amount: number
  description: string
  category: string
}

export function buildRepeatSuggestions(expenses: CardExpense[], limit = 6): RepeatSuggestion[] {
  const seen = new Set<string>()
  const suggestions: RepeatSuggestion[] = []

  for (const expense of expenses) {
    if (expense.status !== 'posted' || expense.installment_count !== 1) continue
    const key = normalizeDescription(expense.description)
    if (!key || seen.has(key)) continue
    seen.add(key)
    suggestions.push({
      cardId: expense.card_id,
      amount: expense.amount,
      description: expense.description,
      category: expense.category || 'Diğer',
    })
    if (suggestions.length >= limit) break
  }

  return suggestions
}
