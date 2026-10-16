import type { CardExpense, TransactionHistory } from '../types/database'
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

export type PaymentMonthMatch = {
  historyId: string
  occurredOn: string
  amount: number | null
  state: 'matched' | 'reversed'
}

/**
 * Aboneliğin eşleşme ayı işlem günü değil, sunucunun kaydettiği VADE ayıdır.
 * Yeni kayıt doğrudan harcama id'si taşır. Eski SMS RPC'sinin açık geçmiş
 * sözleşmesi ("SMS ile eşlendi" + Vade) de kanıttır; tutar/işyeri benzerliği
 * veya planın sonraki aya ilerlemiş olması tek başına eşleşme sayılmaz.
 */
export function matchedPaymentsInMonth(
  history: TransactionHistory[],
  month: Date,
  expenses: Pick<CardExpense, 'id' | 'status'>[] = [],
): Map<string, PaymentMonthMatch> {
  const monthKey = dateInputValue(startOfMonth(month)).slice(0, 7)
  const expenseStatus = new Map(expenses.map((expense) => [expense.id, expense.status]))
  const matches = new Map<string, PaymentMonthMatch>()
  // Manuel/sonraki dönem ödemeleri de stack'e girer: sonraki ödemenin geri
  // alınması önceki ayın eşleşmesini silemez. Geçmiş dizisi yerinde değişmez.
  const events = new Map<string, Array<PaymentMonthMatch | null>>()

  for (const row of [...history].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (row.type !== 'payment' || row.source_table !== 'payments' || !row.source_id) continue
    const stack = events.get(row.source_id) ?? []
    events.set(row.source_id, stack)
    if (isPaymentUndoRow(row)) {
      const undone = stack.pop()
      if (undone && matches.get(row.source_id)?.historyId === undone.historyId) undone.state = 'reversed'
      continue
    }

    const legacySms = row.title.endsWith(' SMS ile eşlendi')
      && (row.note ?? '').includes('banka SMS hareketiyle eşlendi. Vade: ')
    const dueDate = row.payment_due_date ?? (legacySms ? row.note?.match(/Vade: (\d{4}-\d{2}-\d{2})/)?.[1] : undefined)
    const validDueDate = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      && dateInputValue(new Date(`${dueDate}T12:00:00`)) === dueDate
    if ((!row.matched_card_expense_id && !legacySms) || !validDueDate || dueDate.slice(0, 7) !== monthKey) {
      stack.push(null)
      continue
    }
    const occurredAt = new Date(row.occurred_at)
    if (!Number.isFinite(occurredAt.getTime())) { stack.push(null); continue }
    const match: PaymentMonthMatch = {
      historyId: row.id,
      occurredOn: dateInputValue(occurredAt),
      amount: row.amount,
      state: row.matched_card_expense_id && expenseStatus.get(row.matched_card_expense_id) === 'cancelled' ? 'reversed' : 'matched',
    }
    matches.set(row.source_id, match)
    stack.push(match)
  }
  return matches
}
