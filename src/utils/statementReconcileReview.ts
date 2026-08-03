/**
 * Ekstre import mutabakatının son adımı için saf yardımcılar.
 *
 * İki eksik parçayı kapatır:
 *  1. App'te olup ekstrede karşılığı OLMAYAN "fazla" harcamaları bulmak (SMS
 *     mükerreri / iptal edilmemiş kayıt) — bunlar app borcunu bankanın üstüne şişirir.
 *  2. İçe aktarma bitince kalan farkı bankanın bildirdiği toplama kilitleyecek
 *     ters-kaydın işaretini ve denetlenebilir notunu üretmek.
 *
 * Supabase görmez; ledger'a yazma cardsRepo/service işi. Karşılaştırma money.ts
 * ile (float toleransı yaratma).
 */
import { diffTL, equalsTL, roundTL } from './money'

export type ReconcileExpenseRow = {
  id: string
  spent_at: string
  amount: number
  status: string
  description?: string | null
  category?: string | null
  installment_count: number
  note?: string | null
}

/**
 * Dönem içinde app'te olup ekstre satırlarıyla eşleşmeyen, güvenle iptal
 * edilebilir harcamalar.
 *
 * - Yalnız `posted` (dönem içi) tek-çekim kayıtlar; provizyon/iptal elenir.
 * - Taksitler (installment_count > 1) burada DEĞİL, ayrı taksit kontrolünde ele
 *   alınır (tarihsel taksit satırını iptal etmek arşivi bozabilir).
 * - Sonuç tarihe göre sıralı; UI aynı sırada gösterir.
 */
export function findAppOnlyExpenses<T extends ReconcileExpenseRow>(
  periodExpenses: readonly T[],
  matchedExpenseIds: ReadonlySet<string>,
): T[] {
  return periodExpenses
    .filter(
      (expense) =>
        !matchedExpenseIds.has(expense.id) &&
        expense.status === 'posted' &&
        expense.installment_count <= 1,
    )
    .slice()
    .sort((left, right) => left.spent_at.localeCompare(right.spent_at))
}

/**
 * Bankanın bildirdiği toplam ile app'in hesapladığı toplam arasındaki fark.
 * İşaret: `+` → app eksik (bankaya çekmek borcu ARTIRIR),
 *         `−` → app fazla (bankaya çekmek borcu AZALTIR).
 */
export function reconcileResidualTL(bankTotal: number, appTotal: number): number {
  return diffTL(bankTotal, appTotal)
}

/** App zaten bankanın toplamına eşit mi (kilide gerek yok mu)? */
export function isFullyReconciled(bankTotal: number, appTotal: number): boolean {
  return equalsTL(bankTotal, appTotal)
}

/**
 * Kilit ters-kaydının denetlenebilir not metni. Tutar ve dönem açıkça yazılır ki
 * append-only geçmişte "bu düzeltme neden var" sorusu tek satırda cevaplansın.
 */
export function lockCorrectionNote(residualTL: number, periodLabel: string): string {
  const signed = `${residualTL > 0 ? '+' : ''}${roundTL(residualTL)}`
  return `Ekstre mutabakat kilidi: app ${signed} TL banka toplamına çekildi${periodLabel ? ` (dönem ${periodLabel})` : ''}`
}
