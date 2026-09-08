/**
 * Birleşik aktivite akışı (audit trail). Üç farklı olay kaynağını tek
 * kronolojik listeye (en yeni üstte) birleştirir:
 *  - card_ledger        → kart borcu olayları (opening/debit/credit/adjustment)
 *  - account_ledger     → banka bakiyesi olayları (deposit/withdrawal...)
 *  - transaction_history→ kullanıcıya dönük genel işlem geçmişi
 * Ledger tutarları kuruş (bigint) tutulur → toTL ile gösterime çevrilir; işaret
 * yönü (inflow/outflow) belirler. Saf; sadece okuyup birleştirir.
 */
import type { AccountLedger, CardLedger, TransactionHistory } from '../types/database'

type CardLike = { id: string; card_name: string }
import { turkishizeHistoryText } from './historyText'
import { equalsTL, toTL } from './money'
import { normalizeSearchText } from './searchText'

export type ActivityItem = {
  id: string
  timestamp: string
  icon: 'card' | 'account' | 'payment' | 'transfer' | 'loan' | 'debt' | 'asset'
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
  reclass: 'Borç kırılımı kayması',
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
    // Tutarı sıfır olan olay (ör. reclass: borç değişmeden kova kayması) yön
    // taşımaz; aksi halde UI "−₺0,00" basıyordu.
    direction: event.amount_kurus === 0 ? 'neutral' : isCredit ? 'inflow' : 'outflow',
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
    direction: event.amount_kurus === 0 ? 'neutral' : isDeposit ? 'inflow' : 'outflow',
    source: 'account_ledger',
  }
}

const TX_TYPE_ICON: Record<string, ActivityItem['icon']> = {
  payment: 'payment',
  transfer: 'transfer',
  loan: 'loan',
  debt: 'debt',
  card: 'card',
  asset: 'asset',
}

function transactionDirection(tx: TransactionHistory): ActivityItem['direction'] {
  const text = normalizeSearchText(`${tx.title} ${tx.note ?? ''}`)
  const has = (...values: string[]) => values.some((value) => text.includes(value))
  if (has('geri alındı', 'geri alindi')) return 'neutral'

  if (tx.type === 'asset') {
    if (has(' alındı', ' alindi')) return 'outflow'
    if (has(' satıldı', ' satildi')) return 'inflow'
    return 'neutral'
  }
  if (tx.type === 'transfer') {
    if (has('para girişi', 'para girisi')) return 'inflow'
    if (has('para çıkışı', 'para cikisi')) return 'outflow'
    return 'neutral'
  }
  if (tx.type === 'debt') {
    if (has('hesabına', 'hesabina', 'tahsil')) return 'inflow'
    if (has('hesabından', 'hesabindan', 'ödendi', 'odendi')) return 'outflow'
    return 'neutral'
  }
  if (tx.type === 'card') {
    if (text.includes('iptal') || text.includes('iade')) return 'inflow'
    if (tx.source_table === 'card_statement_archives') return 'neutral'
    return tx.amount != null ? 'outflow' : 'neutral'
  }
  if (tx.type === 'payment' || tx.type === 'loan') return tx.amount != null ? 'outflow' : 'neutral'
  return 'neutral'
}

function transactionToActivity(tx: TransactionHistory): ActivityItem {
  return {
    id: `th-${tx.id}`,
    timestamp: tx.occurred_at,
    icon: TX_TYPE_ICON[tx.type] ?? 'payment',
    // SQL ASCII yazar; ekranda Türkçe (B16). Yön tespiti ham metinden yapılır.
    title: turkishizeHistoryText(tx.title),
    detail: tx.note ? turkishizeHistoryText(tx.note) : tx.note,
    amountTL: tx.amount,
    direction: transactionDirection(tx),
    source: 'transaction_history',
  }
}

const AUTO_LEDGER_NOTE = /\(otomatik kayıt\)/
const AUTO_LEDGER_WINDOW_MS = 2 * 60 * 1000

/**
 * "Tümü" görünümünde trigger'ın otomatik ledger satırı, aynı anda aynı tutarla
 * yazılmış geçmiş kaydının yanında ikinci bir satır olarak duruyordu (her işlem
 * çift görünüyordu — UX turu B16). Otomatik satır, ±2 dk içinde aynı tutarlı bir
 * geçmiş kaydı varsa gizlenir; "Kart borcu" / "Hesap" filtrelerinde tümü kalır.
 */
function dropAutoLedgerEchoes(items: ActivityItem[]): ActivityItem[] {
  const history = items.filter((item) => item.source === 'transaction_history')
  if (history.length === 0) return items
  return items.filter((item) => {
    if (item.source === 'transaction_history' || !item.detail || !AUTO_LEDGER_NOTE.test(item.detail)) return true
    const at = new Date(item.timestamp).getTime()
    return !history.some(
      (tx) => tx.amountTL != null && item.amountTL != null && equalsTL(tx.amountTL, item.amountTL)
        && Math.abs(new Date(tx.timestamp).getTime() - at) <= AUTO_LEDGER_WINDOW_MS,
    )
  })
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

  const visible = filter === 'all' ? dropAutoLedgerEchoes(items) : items
  visible.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return visible
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
