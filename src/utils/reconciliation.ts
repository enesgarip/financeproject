import type { AccountReconciliation, Card, ReconciliationTarget } from '../types/database'
import { diffTL, equalsTL, sumKurus, toKurus, toTL } from './money'

/**
 * Live-balance reconciliation (roadmap A3): compare the app's current figure for
 * each account/card against the real figure from the user's bank, and track the
 * ritual ("last reconciled N days ago", drift trend). Pure and money.ts-backed.
 *
 * Faz D1: `drift` ham gözlemdir ve düzeltme uygulansa bile değişmez; "kapandı mı"
 * sorusunun cevabı `resolution` kolonundadır. Önceden düzeltme anında drift 0'a
 * çekildiği için her kart 'ok' görünüyor ve sapma trendi hiç oluşamıyordu.
 * `resolution = null` olan eski kayıtlarda akıbet bilinmediği için eski davranışa
 * (drift ≠ 0 → çözülmemiş) düşülür.
 */

/**
 * Days after which a reconciliation is considered stale and worth repeating.
 * 7 gün: uygulama manuel olduğu için app ile banka arasında sürekli küçük fark
 * birikiyor. Haftalık kadans farkı büyümeden yakalar (30 gün çok geçti).
 * Aynı eşik push-notify'ın haftalık mutabakat hatırlatmasında da kullanılır.
 */
export const STALE_AFTER_DAYS = 7

/** Which figure a card reconciles: bank accounts → balance, credit cards → debt. */
export function reconcileTarget(card: Pick<Card, 'card_type'>): ReconciliationTarget {
  return card.card_type === 'kredi_karti' ? 'debt' : 'balance'
}

/** The app's current figure for a card (current_balance or debt_amount). */
export function appAmount(card: Pick<Card, 'card_type' | 'current_balance' | 'debt_amount'>): number {
  return reconcileTarget(card) === 'debt' ? card.debt_amount : card.current_balance
}

/** Signed drift (TL): app figure − real figure, at kuruş precision. */
export function computeDrift(app: number, real: number): number {
  return diffTL(app, real)
}

/** True when app and real agree to the kuruş (no meaningful drift). */
export function isReconciled(app: number, real: number): boolean {
  return equalsTL(app, real)
}

export type ReconcileStatus = 'never' | 'ok' | 'drift' | 'stale'

function daysBetween(fromIso: string, today: Date): number {
  const from = new Date(fromIso)
  const ms = today.getTime() - from.getTime()
  return Math.floor(ms / 86_400_000)
}

/**
 * Bir mutabakat kaydının yaşı (tam gün). Geçersiz tarih sonsuz yaş sayılır ki
 * çağıran onu "bayat" kabul etsin; negatif (gelecek tarihli) kayıt 0'a kırpılır.
 * cardControlCenter bu yardımcıyı buradan kullanır — kopya tutulmaz.
 */
export function reconciliationAgeDays(reconciledAt: string, now: Date): number {
  const reconciledTime = new Date(reconciledAt).getTime()
  if (!Number.isFinite(reconciledTime)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((now.getTime() - reconciledTime) / 86_400_000))
}

export type ReconciliationItem = {
  card: Card
  target: ReconciliationTarget
  /** App's current figure. */
  app: number
  /** Most recent reconciliation for this card, if any. */
  last: AccountReconciliation | null
  /** Days since last reconciliation; null when never reconciled. */
  daysSince: number | null
  status: ReconcileStatus
}

/**
 * Bir mutabakat kaydının farkı hâlâ açık mı? `resolution` varsa ona bakılır;
 * yoksa (eski kayıt) tek elimizdeki sinyal drift'in kendisidir.
 */
export function isUnresolvedDrift(row: AccountReconciliation): boolean {
  if (row.resolution === 'open') return true
  if (row.resolution === 'matched' || row.resolution === 'corrected') return false
  return !equalsTL(row.drift, 0)
}

/**
 * Build per-card reconciliation rows from the cards and their latest
 * reconciliation. Status:
 *  - never: no reconciliation on record
 *  - drift: son mutabakatta fark çıktı ve kapatılmadı (resolution='open', ya da
 *           eski kayıtta drift ≠ 0)
 *  - stale: reconciled but longer ago than STALE_AFTER_DAYS
 *  - ok:    yakın zamanda mutabık olundu (fark yoktu ya da düzeltildi)
 * Sorted most-actionable first (drift → never → stale → ok).
 */
export function buildReconciliationItems(
  cards: Card[],
  latestByCard: Map<string, AccountReconciliation>,
  today: Date = new Date(),
  staleAfterDays: number = STALE_AFTER_DAYS,
): ReconciliationItem[] {
  const rank: Record<ReconcileStatus, number> = { drift: 0, never: 1, stale: 2, ok: 3 }

  const items = cards.map((card): ReconciliationItem => {
    const last = latestByCard.get(card.id) ?? null
    const daysSince = last ? daysBetween(last.reconciled_at, today) : null

    let status: ReconcileStatus
    if (!last) status = 'never'
    else if (isUnresolvedDrift(last)) status = 'drift'
    else if (daysSince != null && daysSince > staleAfterDays) status = 'stale'
    else status = 'ok'

    return { card, target: reconcileTarget(card), app: appAmount(card), last, daysSince, status }
  })

  return items.sort((a, b) => rank[a.status] - rank[b.status])
}

export type DriftHistorySummary = {
  /** Bakılan mutabakat sayısı (en yeniden geriye, `limit` kadar). */
  sampleCount: number
  /** İçlerinde sıfırdan farklı sapma ölçülenlerin sayısı. */
  driftCount: number
  /** Ölçülen sapmaların işaretli toplamı (TL) — yön eğilimi. */
  netDriftTL: number
  /** En büyük mutlak sapma (TL). */
  largestDriftTL: number
  /** Örneklemde akıbeti bilinmeyen (resolution = null) eski kayıt var mı? */
  hasLegacyRows: boolean
}

/**
 * Bir kartın son `limit` mutabakatından sapma eğilimi. "Bu kartta sürekli fark
 * çıkıyor mu, yoksa tek seferlik miydi?" sorusunun cevabı — tek bir 'Fark var'
 * rozetinin söyleyemediği şey.
 *
 * Eski kayıtlarda düzeltilen fark 0 olarak yazıldığı için sayım onları sapma
 * saymaz; `hasLegacyRows` bu körlüğü açıkça bildirir ki eksik sayım kesin
 * gerçek gibi okunmasın.
 */
export function buildDriftHistory(
  rows: AccountReconciliation[],
  cardId: string,
  limit = 5,
): DriftHistorySummary {
  const recent = rows
    .filter((row) => row.card_id === cardId)
    .sort((a, b) => b.reconciled_at.localeCompare(a.reconciled_at))
    .slice(0, limit)

  const drifted = recent.filter((row) => !equalsTL(row.drift, 0))

  return {
    sampleCount: recent.length,
    driftCount: drifted.length,
    netDriftTL: toTL(sumKurus(drifted.map((row) => toKurus(row.drift)))),
    largestDriftTL: drifted.reduce((max, row) => Math.max(max, Math.abs(row.drift)), 0),
    hasLegacyRows: recent.some((row) => row.resolution === null),
  }
}

export type DriftCauseEvent = {
  occurred_at: string
  kind: string
  amountTL: number
  note: string | null
}

export type DriftCauseSummary = {
  events: DriftCauseEvent[]
  totalChangeTL: number
  eventCount: number
}

export function buildDriftCauseSummary(
  ledgerEvents: Array<{ occurred_at: string; kind: string; amount_kurus: number; note: string | null }>,
): DriftCauseSummary {
  const events = ledgerEvents.map((e) => ({
    occurred_at: e.occurred_at,
    kind: e.kind,
    amountTL: toTL(e.amount_kurus),
    note: e.note,
  }))
  const totalChangeTL = toTL(sumKurus(ledgerEvents.map((e) => e.amount_kurus)))
  return { events, totalChangeTL, eventCount: ledgerEvents.length }
}

/** Pick the most recent reconciliation per card_id from a flat list. */
export function latestReconciliationByCard(rows: AccountReconciliation[]): Map<string, AccountReconciliation> {
  const byCard = new Map<string, AccountReconciliation>()
  for (const row of rows) {
    const current = byCard.get(row.card_id)
    if (!current || row.reconciled_at > current.reconciled_at) byCard.set(row.card_id, row)
  }
  return byCard
}
