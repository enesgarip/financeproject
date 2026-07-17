import type { TransactionHistory } from '../types/database'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { normalizeSearchText } from './searchText'

/** Seçili ayda gerçekten ödenmiş planlı ödeme kimlikleri (history contract). */
export function paidPaymentIdsInMonth(history: TransactionHistory[], month: Date = new Date()): Set<string> {
  const monthStart = dateInputValue(startOfMonth(month))
  const monthEnd = dateInputValue(startOfMonth(addMonths(month, 1)))
  const ids = new Set<string>()

  for (const row of [...history].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (row.type !== 'payment' || row.source_table !== 'payments' || !row.source_id) continue
    const occurredDate = dateInputValue(new Date(row.occurred_at))
    if (occurredDate < monthStart || occurredDate >= monthEnd) continue
    const text = normalizeSearchText(`${row.title} ${row.note ?? ''}`)
    if (text.includes('geri alındı') || text.includes('geri alindi')) {
      ids.delete(row.source_id)
    } else {
      ids.add(row.source_id)
    }
  }

  return ids
}
