import type { CardLedger } from '../types/database'
import { diffTL, sumKurus, toTL } from './money'

/**
 * Projection over the append-only card debt ledger (roadmap A2).
 *
 * A credit card's debt is the sum of its events. Events store signed integer
 * kuruş (+debit / -credit), so the projection is exact — no float drift. This
 * is the read side of the event-sourced money model: the stored
 * `cards.debt_amount` can be reconciled against (and eventually replaced by)
 * `projectCardDebt(events)`.
 */

export type CardLedgerEvent = Pick<CardLedger, 'card_id' | 'kind' | 'amount_kurus' | 'occurred_at'>

/** Projected debt for a set of events, in integer kuruş (exact). */
export function projectCardDebtKurus(events: CardLedgerEvent[]): number {
  return sumKurus(events.map((event) => event.amount_kurus))
}

/** Projected debt in TL (kuruş projection converted at the display boundary). */
export function projectCardDebt(events: CardLedgerEvent[]): number {
  return toTL(projectCardDebtKurus(events))
}

/** Group events by card id, preserving input order within each card. */
export function groupEventsByCard(events: CardLedgerEvent[]): Map<string, CardLedgerEvent[]> {
  const byCard = new Map<string, CardLedgerEvent[]>()
  for (const event of events) {
    const list = byCard.get(event.card_id)
    if (list) list.push(event)
    else byCard.set(event.card_id, [event])
  }
  return byCard
}

/** Projected debt per card id, in TL. */
export function projectDebtByCard(events: CardLedgerEvent[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const [cardId, cardEvents] of groupEventsByCard(events)) {
    result.set(cardId, projectCardDebt(cardEvents))
  }
  return result
}

/**
 * Signed drift (TL) between the stored debt and the ledger projection.
 * 0 means the ledger fully explains the stored balance. Positive = stored is
 * higher than the events account for (an untracked debit slipped in).
 */
export function ledgerDrift(events: CardLedgerEvent[], storedDebt: number): number {
  return diffTL(storedDebt, projectCardDebt(events))
}

export type CardLedgerSummary = {
  /** Number of events. */
  count: number
  /** Sum of positive (debit) events, TL. */
  totalDebit: number
  /** Sum of negative (credit) events as a positive TL figure. */
  totalCredit: number
  /** Net projected debt, TL. */
  net: number
}

/** Debit/credit breakdown — feeds the "bu borç neyden oluşuyor" view (D9). */
export function summarizeCardLedger(events: CardLedgerEvent[]): CardLedgerSummary {
  let debitKurus = 0
  let creditKurus = 0
  for (const event of events) {
    if (event.amount_kurus >= 0) debitKurus += event.amount_kurus
    else creditKurus += event.amount_kurus
  }
  return {
    count: events.length,
    totalDebit: toTL(debitKurus),
    totalCredit: toTL(-creditKurus),
    net: toTL(debitKurus + creditKurus),
  }
}
