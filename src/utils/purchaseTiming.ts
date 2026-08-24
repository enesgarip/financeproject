/**
 * "Bu harcamayı ne zaman yaparsam ne zaman öderim?" — kesim günü etkisi (saf).
 *
 * Kredi kartında nakit çıkışı harcama anında değil, harcamanın düştüğü
 * EKSTRENİN son ödeme gününde olur. Kesime bir gün kala yapılan alışveriş bu
 * yüzden neredeyse hemen, kesimin ertesi günü yapılan aynı alışveriş ise bir ay
 * sonra ödenir. Uygulama kesim/vade gününü zaten biliyor ama bu bilgi karar
 * anında (harcama girerken) hiç görünmüyordu.
 *
 * Dönem/vade matematiği TEK yerde: `cardStatement.getCardStatementPeriod`.
 * Burada yalnız "bugün alırsam" ile "kesimden sonra alırsam" karşılaştırılır.
 */
import type { Card } from '../types/database'
import { getCardStatementPeriod } from './cardStatement'
import { addDays, startOfDay } from './date'

const DAY_IN_MS = 86_400_000

export type PurchaseTimingHint = {
  /** Bugün alırsan ödeme günü (ISO) ve kaç gün sonra ödersin. */
  dueDate: string
  daysUntilDue: number
  /** Ekstre kesimine kalan gün (0 = bugün kesim günü, harcama bu ekstreye girer). */
  daysUntilStatement: number
  /** Kesimden SONRA alırsan ödeme günü ve kaç gün sonra ödersin. */
  waitDueDate: string
  waitDaysUntilDue: number
  /** Beklemenin kazandırdığı gün sayısı. */
  gainDays: number
  /**
   * Kesim yeterince yakın mı? Uzaktaki kesim için "beklesen" demek gerçekçi
   * değil (kimse alışverişi 3 hafta ertelemez), o yüzden arayüz önerisini
   * yalnız bu true iken gösterir.
   */
  waitWorthIt: boolean
}

function daysBetween(fromValue: Date, toIso: string): number {
  const target = startOfDay(new Date(`${toIso}T00:00:00`))
  return Math.round((target.getTime() - startOfDay(fromValue).getTime()) / DAY_IN_MS)
}

/**
 * `waitWindowDays`: kesime bu kadar (ya da daha az) gün kaldıysa "beklemeye
 * değer" sayılır. Varsayılan 5 gün — bir alışverişi ertelemenin makul üst sınırı.
 */
export function buildPurchaseTimingHint(
  card: Pick<Card, 'card_type' | 'statement_day' | 'due_day'> | null | undefined,
  today: Date = new Date(),
  waitWindowDays = 5,
): PurchaseTimingHint | null {
  const current = getCardStatementPeriod(card, today)
  if (!current) return null

  // Kesim gününün harcaması O ekstreye dahildir; "sonraki döneme kaçmak" için
  // kesimin ERTESİ günü referans alınır (canCutCurrentStatement ile aynı kural).
  const afterStatement = addDays(startOfDay(new Date(`${current.statementDate}T00:00:00`)), 1)
  const next = getCardStatementPeriod(card, afterStatement)
  if (!next) return null

  const daysUntilDue = daysBetween(today, current.dueDate)
  const waitDaysUntilDue = daysBetween(afterStatement, next.dueDate)
  const daysUntilStatement = daysBetween(today, current.statementDate)
  const gainDays = daysBetween(today, next.dueDate) - daysUntilDue

  return {
    dueDate: current.dueDate,
    daysUntilDue,
    daysUntilStatement,
    waitDueDate: next.dueDate,
    waitDaysUntilDue,
    gainDays,
    waitWorthIt: gainDays > 0 && daysUntilStatement >= 0 && daysUntilStatement <= waitWindowDays,
  }
}
