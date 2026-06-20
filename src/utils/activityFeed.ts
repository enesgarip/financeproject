import type { AccountLedger, CardLedger, TransactionHistory } from '../types/database'

type CardLike = { id: string; card_name: string }
import { toTL } from './money'

export type ActivityItem = {
  id: string
  timestamp: string
  icon: 'card' | 'account' | 'payment' | 'transfer' | 'loan' | 'debt'
  title: string
  detail: string | null
  amountTL: number | null
  direction: 'inflow' | 'outflow' | 'neutral'
  source: 'card_ledger' | 'account_ledger' | 'transaction_history'
}

const CARD_LEDGER_KIND_LABEL: Record<string, string> = {
  opening: 'Açılış bakiyesi',
  debit: 'Borç artışı',
  credit: 'Borç azalışı',
  adjustment: 'Düzeltme',
}

const ACCOUNT_LEDGER_KIND_LABEL: Record<string, string> = {
  opening: 'Açılış bakiyesi',
  deposit: 'Para girişi',
  withdrawal: 'Para çıkışı',
  adjustment: 'Düzeltme',
}

function cardName(cardId: string, cards: CardLike[]): string {
  return cards.find((c) => c.id === cardId)?.card_name ?? 'Bilinmeyen hesap'
}

function cardLedgerToActivity(event: CardLedger, cards: CardLike[]): ActivityItem {
  const amountTL = toTL(Math.abs(event.amount_kurus))
  const isCredit = event.amount_kurus < 0
  return {
    id: `cl-${event.id}`,
    timestamp: event.occurred_at,
    icon: 'card',
    title: CARD_LEDGER_KIND_LABEL[event.kind] ?? event.kind,
    detail: `${cardName(event.card_id, cards)}${event.note ? ` — ${event.note}` : ''}`,
    amountTL,
    direction: isCredit ? 'inflow' : 'outflow',
    source: 'card_ledger',
  }
}

function accountLedgerToActivity(event: AccountLedger, cards: CardLike[]): ActivityItem {
  const amountTL = toTL(Math.abs(event.amount_kurus))
  const isDeposit = event.amount_kurus > 0
  return {
    id: `al-${event.id}`,
    timestamp: event.occurred_at,
    icon: 'account',
    title: ACCOUNT_LEDGER_KIND_LABEL[event.kind] ?? event.kind,
    detail: `${cardName(event.card_id, cards)}${event.note ? ` — ${event.note}` : ''}`,
    amountTL,
    direction: isDeposit ? 'inflow' : 'outflow',
    source: 'account_ledger',
  }
}

const TX_TYPE_ICON: Record<string, ActivityItem['icon']> = {
  payment: 'payment',
  transfer: 'transfer',
  loan: 'loan',
  debt: 'debt',
  card: 'card',
}

function transactionToActivity(tx: TransactionHistory): ActivityItem {
  return {
    id: `th-${tx.id}`,
    timestamp: tx.occurred_at,
    icon: TX_TYPE_ICON[tx.type] ?? 'payment',
    title: tx.title,
    detail: tx.note,
    amountTL: tx.amount,
    direction: tx.amount != null && tx.amount < 0 ? 'outflow' : tx.amount != null && tx.amount > 0 ? 'inflow' : 'neutral',
    source: 'transaction_history',
  }
}

export type ActivityFilter = 'all' | 'card_ledger' | 'account_ledger' | 'transaction_history'

export function buildActivityFeed(
  cardLedger: CardLedger[],
  accountLedger: AccountLedger[],
  transactionHistory: TransactionHistory[],
  cards: CardLike[],
  filter: ActivityFilter = 'all',
): ActivityItem[] {
  const items: ActivityItem[] = []

  if (filter === 'all' || filter === 'card_ledger') {
    for (const event of cardLedger) items.push(cardLedgerToActivity(event, cards))
  }
  if (filter === 'all' || filter === 'account_ledger') {
    for (const event of accountLedger) items.push(accountLedgerToActivity(event, cards))
  }
  if (filter === 'all' || filter === 'transaction_history') {
    for (const tx of transactionHistory) items.push(transactionToActivity(tx))
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return items
}

export function groupByDate(items: ActivityItem[]): Map<string, ActivityItem[]> {
  const groups = new Map<string, ActivityItem[]>()
  for (const item of items) {
    const date = item.timestamp.slice(0, 10)
    const group = groups.get(date)
    if (group) group.push(item)
    else groups.set(date, [item])
  }
  return groups
}
