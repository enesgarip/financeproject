/**
 * Ekstre tahmini (saf): kesime az kala "bu dönem kapanırsa ekstre ~₺X gelir".
 *
 * Tahmin = kartın dönem içi borç kovası (current_period_spending — kesimde
 * ekstreye reclass olan kova) + o ekstre ayına düşen planlı taksitler. "~" dili
 * bilinçli: bekleyen provizyonlar (kesimden önce kesinleşebilir de kalabilir de)
 * ve faiz bilinemez — satır kesin rakam vaat etmez, sürprizi küçültür.
 *
 * purchaseTiming ile aynı pencere disiplini: yalnız kesime ≤5 gün kala görünür
 * (üç hafta önceden ekstre tahmini gürültü olurdu).
 */
import type { Card, CardInstallment } from '../types/database'
import { getCardStatementPeriod } from './cardStatement'
import { startOfDay } from './date'
import { roundTL, sumTL } from './money'

const ESTIMATE_WINDOW_DAYS = 5

export type StatementEstimate = {
  /** Tahmini ekstre toplamı (~). */
  amount: number
  /** Kesime kalan gün (0 = bugün kesim). */
  daysToCut: number
  statementDate: string
}

export function estimateStatementTotal(
  card: Pick<Card, 'id' | 'card_type' | 'statement_day' | 'due_day' | 'current_period_spending'>,
  installments: CardInstallment[],
  today: Date = new Date(),
): StatementEstimate | null {
  const period = getCardStatementPeriod(card, today)
  if (!period) return null

  const daysToCut = Math.round(
    (new Date(`${period.statementDate}T00:00:00`).getTime() - startOfDay(today).getTime()) / 86_400_000,
  )
  if (daysToCut < 0 || daysToCut > ESTIMATE_WINDOW_DAYS) return null

  const statementMonth = period.statementDate.slice(0, 7)
  const installmentTotal = sumTL(
    installments
      .filter((item) => item.card_id === card.id && item.status === 'scheduled')
      .filter((item) => item.due_month.slice(0, 7) === statementMonth)
      .map((item) => item.amount),
  )

  return {
    amount: roundTL(sumTL([card.current_period_spending, installmentTotal])),
    daysToCut,
    statementDate: period.statementDate,
  }
}
