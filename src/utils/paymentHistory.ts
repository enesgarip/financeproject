import type { TransactionHistory } from '../types/database'
import { addDays, addMonths, dateInputValue, startOfMonth } from './date'
import { normalizeSearchText } from './searchText'

/**
 * "Geri alındı" sözleşmesi: ödeme geri alma RPC'leri işlem geçmişine serbest
 * metin başlık/not yazar (bkz. `unpay_*` migration'ları). Elimizdeki tek sinyal
 * bu metin olduğu için kalıbı TEK yerde tutuyoruz — DB notu değişirse burası
 * kırılır ve tek dosya güncellenir (activityFeed / realizedCashFlow aynı kalıbı
 * kendi bağlamlarında kullanır).
 */
export const PAYMENT_UNDO_MARKERS = ['geri alındı', 'geri alindi'] as const

/**
 * Ay kapandıktan sonra geri alma kaç gün daha izlenir. 31 Temmuz'da ödenip
 * 1 Ağustos'ta geri alınan ödeme, pencere olmadan Temmuz'da sonsuza dek
 * "ödendi" görünüyordu; gecikmeli fark etme gerçek hayatta günler sürebilir.
 */
export const PAYMENT_UNDO_GRACE_DAYS = 10

/** Bu geçmiş satırı bir ödemenin geri alınması mı? (serbest metin sözleşmesi) */
export function isPaymentUndoRow(row: Pick<TransactionHistory, 'title' | 'note'>): boolean {
  const text = normalizeSearchText(`${row.title} ${row.note ?? ''}`)
  return PAYMENT_UNDO_MARKERS.some((marker) => text.includes(marker))
}

/** Seçili ayda gerçekten ödenmiş planlı ödeme kimlikleri (history contract). */
export function paidPaymentIdsInMonth(history: TransactionHistory[], month: Date = new Date()): Set<string> {
  const nextMonthStart = startOfMonth(addMonths(month, 1))
  const monthStart = dateInputValue(startOfMonth(month))
  const monthEnd = dateInputValue(nextMonthStart)
  const undoWindowEnd = dateInputValue(addDays(nextMonthStart, PAYMENT_UNDO_GRACE_DAYS))
  const ids = new Set<string>()
  // Ay kapandıktan sonra AYNI ödemeye yapılan yeni tahsilat; sonraki geri alma
  // o yeni ödemeyi tersler, bu ayın kaydını değil (aylık tekrar eden ödemelerde
  // source_id aynı satırdır, yoksa Temmuz yanlışlıkla ödenmemiş sayılırdı).
  const repaidAfterMonth = new Set<string>()

  for (const row of [...history].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (row.type !== 'payment' || row.source_table !== 'payments' || !row.source_id) continue
    const occurredDate = dateInputValue(new Date(row.occurred_at))
    if (occurredDate < monthStart) continue
    const isUndo = isPaymentUndoRow(row)

    if (occurredDate >= monthEnd) {
      if (!isUndo) {
        repaidAfterMonth.add(row.source_id)
        continue
      }
      if (repaidAfterMonth.delete(row.source_id)) continue
      if (occurredDate < undoWindowEnd) ids.delete(row.source_id)
      continue
    }

    if (isUndo) ids.delete(row.source_id)
    else ids.add(row.source_id)
  }

  return ids
}
