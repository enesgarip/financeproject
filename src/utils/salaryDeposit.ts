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

/** Değişiklik adayının bandı: maaşın yarısından az giriş maaş değildir (prim
 *  kesintisi bile maaşı yarıya indirmez), 1,6 katından fazlası da değildir
 *  (zam sıçraması bunun altında kalır; üstü büyük ihtimalle başka bir giriş). */
const SALARY_CHANGE_MIN_RATIO = 0.5
const SALARY_CHANGE_MAX_RATIO = 1.6

/**
 * "Maaşın değişti mi?" adayı: ±%10 bandında eşleşme YOKKEN (maaş yerinde
 * görünmüyorken) banda yakın büyüklükte bir giriş varsa onu önerir.
 *
 * Hesaplar arası transferin iki bacağı vardır (kaynağa çıkış + hedefe giriş);
 * aynı gün eşit tutarlı bir ÇIKIŞI olan giriş transfer sayılır ve elenir —
 * yoksa birikim hesabına atılan büyük transfer "maaşın 118.000 mi oldu?"
 * diye sorardı. Girdi bu yüzden yalnız deposit değil TÜM event'lerdir.
 */
export function findSalaryChangeCandidate(
  events: Array<Pick<AccountLedger, 'kind' | 'occurred_at' | 'amount_kurus'>>,
  salaryAmount: number | null | undefined,
): SalaryDepositMatch | null {
  if (!salaryAmount || salaryAmount <= 0) return null
  // Maaş ±%10 bandında yattıysa değişiklik yok; öneri gürültü olur.
  if (findSalaryDeposit(events, salaryAmount)) return null

  // Gün + mutlak kuruş anahtarıyla çıkışlar: transfer bacağı eşleme tablosu.
  const outflowKeys = new Set(
    events
      .filter((event) => toTL(event.amount_kurus) < 0)
      .map((event) => `${event.occurred_at.slice(0, 10)}:${Math.abs(event.amount_kurus)}`),
  )

  const candidate = events
    .filter((event) => event.kind === 'deposit')
    .map((event) => ({ occurredAt: event.occurred_at, amount: toTL(event.amount_kurus), kurus: event.amount_kurus }))
    .filter((event) => event.amount >= salaryAmount * SALARY_CHANGE_MIN_RATIO)
    .filter((event) => event.amount <= salaryAmount * SALARY_CHANGE_MAX_RATIO)
    .filter((event) => !outflowKeys.has(`${event.occurredAt.slice(0, 10)}:${Math.abs(event.kurus)}`))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))[0]

  return candidate ? { matchedAt: candidate.occurredAt.slice(0, 10), amount: candidate.amount } : null
}
