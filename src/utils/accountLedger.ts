import type { AccountLedger } from '../types/database'
import { diffTL, sumKurus, toKurus, toTL } from './money'

/**
 * Projection over the append-only bank-account balance ledger (roadmap Faz 3).
 *
 * A bank account's balance is the sum of its events. Events store signed integer
 * kuruş (+deposit / -withdrawal), so the projection is exact — no float drift.
 * This is the read side of the event-sourced cash model: the stored
 * `cards.current_balance` can be reconciled against `projectAccountBalance(events)`.
 * Mirrors utils/cardLedger.ts.
 */

export type AccountLedgerEvent = Pick<AccountLedger, 'card_id' | 'kind' | 'amount_kurus' | 'occurred_at'>

/** Projected balance for a set of events, in integer kuruş (exact). */
export function projectAccountBalanceKurus(events: AccountLedgerEvent[]): number {
  return sumKurus(events.map((event) => event.amount_kurus))
}

/** Projected balance in TL (kuruş projection converted at the display boundary). */
export function projectAccountBalance(events: AccountLedgerEvent[]): number {
  return toTL(projectAccountBalanceKurus(events))
}

/** Group events by card id, preserving input order within each card. */
export function groupEventsByAccount(events: AccountLedgerEvent[]): Map<string, AccountLedgerEvent[]> {
  const byCard = new Map<string, AccountLedgerEvent[]>()
  for (const event of events) {
    const list = byCard.get(event.card_id)
    if (list) list.push(event)
    else byCard.set(event.card_id, [event])
  }
  return byCard
}

/** Projected balance per card id, in TL. */
export function projectBalanceByAccount(events: AccountLedgerEvent[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const [cardId, cardEvents] of groupEventsByAccount(events)) {
    result.set(cardId, projectAccountBalance(cardEvents))
  }
  return result
}

/**
 * Signed drift (TL) between the stored balance and the ledger projection.
 * 0 means the ledger fully explains the stored balance. Positive = stored is
 * higher than the events account for (an untracked deposit slipped in).
 */
export function balanceDrift(events: AccountLedgerEvent[], storedBalance: number): number {
  return diffTL(storedBalance, projectAccountBalance(events))
}

export type AccountLedgerBalanceRow<TEvent extends AccountLedgerEvent = AccountLedgerEvent> = {
  event: TEvent
  balanceAfter: number
}

/**
 * Events are queried newest-first in the UI. Given the current stored balance,
 * walk backwards to show the bank-style "balance after this transaction" value
 * for each row without trusting float arithmetic.
 */
export function buildAccountLedgerBalanceRows<TEvent extends AccountLedgerEvent>(
  eventsNewestFirst: TEvent[],
  currentBalance: number,
): AccountLedgerBalanceRow<TEvent>[] {
  let newerEventTotalKurus = 0
  const currentBalanceKurus = toKurus(currentBalance)

  return eventsNewestFirst.map((event) => {
    const balanceAfter = toTL(currentBalanceKurus - newerEventTotalKurus)
    newerEventTotalKurus += Math.trunc(event.amount_kurus)
    return { event, balanceAfter }
  })
}

export type AccountLedgerSummary = {
  /** Number of events. */
  count: number
  /** Sum of positive (deposit) events, TL. */
  totalIn: number
  /** Sum of negative (withdrawal) events as a positive TL figure. */
  totalOut: number
  /** Net projected balance, TL. */
  net: number
}

/** Deposit/withdrawal breakdown — feeds the "bu bakiye neyden oluşuyor" view. */
export function summarizeAccountLedger(events: AccountLedgerEvent[]): AccountLedgerSummary {
  let inKurus = 0
  let outKurus = 0
  for (const event of events) {
    const k = Math.trunc(event.amount_kurus)
    if (k >= 0) inKurus += k
    else outKurus += k
  }
  return {
    count: events.length,
    totalIn: toTL(inKurus),
    totalOut: toTL(-outKurus),
    net: toTL(inKurus + outKurus),
  }
}
