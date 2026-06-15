import type { AccountReconciliation, Card, ReconciliationTarget } from '../types/database'
import { diffTL, equalsTL, sumKurus, toTL } from './money'

/**
 * Live-balance reconciliation (roadmap A3): compare the app's current figure for
 * each account/card against the real figure from the user's bank, and track the
 * ritual ("last reconciled N days ago", drift trend). Pure and money.ts-backed.
 */

/** Days after which a reconciliation is considered stale and worth repeating. */
export const STALE_AFTER_DAYS = 30

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
 * Build per-card reconciliation rows from the cards and their latest
 * reconciliation. Status:
 *  - never: no reconciliation on record
 *  - drift: last reconciliation showed app ≠ real (still unresolved)
 *  - stale: reconciled but longer ago than STALE_AFTER_DAYS
 *  - ok:    reconciled recently with no drift
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
    else if (!equalsTL(last.drift, 0)) status = 'drift'
    else if (daysSince != null && daysSince > staleAfterDays) status = 'stale'
    else status = 'ok'

    return { card, target: reconcileTarget(card), app: appAmount(card), last, daysSince, status }
  })

  return items.sort((a, b) => rank[a.status] - rank[b.status])
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
