/**
 * Maaş yatışı tespiti (saf). Uygulama maaşın TUTARINI zaten biliyor
 * (salary_history) ve hesaba girişleri görüyor (account_ledger 'deposit'
 * event'leri); ikisini eşleyince "maaş yattı görünüyor" karar anı doğar —
 * hedefe ayırma hatırlatması takvim tahmini yerine gerçek yatışa bağlanır.
 *
 * Eşleşme kuralı bilinçli GEVŞEK (±%10): maaş kesinti/prim ile oynar, SMS
 * yuvarlaması olur. Yanlış pozitifin bedeli küçük (bir bilgi şeridi/push),
 * yanlış negatifin bedeli hatırlatmanın kaybı.
 *
 * Deno ikizi: supabase/functions/push-notify/index.ts (edge import edemez;
 * testli mantık burada, oradaki kopya yorumla buraya işaret eder).
 */
import type { AccountLedger } from '../types/database'
import { toTL } from './money'

const SALARY_MATCH_TOLERANCE = 0.1

export type SalaryDepositMatch = {
  /** Eşleşen yatışın günü (ISO, date kısmı). */
  matchedAt: string
  amount: number
}

/**
 * Verilen (çağıranın ay başından beri diye pencerelediği) deposit event'leri
 * içinde maaşa benzeyen ilk girişi bulur; yoksa null.
 */
export function findSalaryDeposit(
  deposits: Array<Pick<AccountLedger, 'kind' | 'occurred_at' | 'amount_kurus'>>,
  salaryAmount: number | null | undefined,
): SalaryDepositMatch | null {
  if (!salaryAmount || salaryAmount <= 0) return null

  const tolerance = salaryAmount * SALARY_MATCH_TOLERANCE
  const match = deposits
    .filter((event) => event.kind === 'deposit')
    .map((event) => ({ occurredAt: event.occurred_at, amount: toTL(event.amount_kurus) }))
    .filter((event) => event.amount > 0 && Math.abs(event.amount - salaryAmount) <= tolerance)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0]

  return match ? { matchedAt: match.occurredAt.slice(0, 10), amount: match.amount } : null
}
