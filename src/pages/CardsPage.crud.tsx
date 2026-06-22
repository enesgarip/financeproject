import { ReceiptText } from 'lucide-react'
import type { Card, InsertFor, UpdateFor } from '../types/database'
import { cardProvisionAmount, cardSplitTotal } from '../utils/financeSummary'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { equalsTL } from '../utils/money'
import {
  bankHueStyle,
  cardGroupLabel,
  cardTypeLabel,
  limitGroupStats,
  optionalDay,
} from './CardsPage.helpers'

type CardPayload = InsertFor<'cards'> | UpdateFor<'cards'>

type CardRowsHelper = {
  reload: () => Promise<void>
  rows: Card[]
}

type OpenAccountTransaction = (card: Card, reload: () => Promise<void>, cards: Card[], type?: 'in' | 'out' | 'transfer') => void

export function getCardInitialValues(row?: Card) {
  return {
    bank_name: row?.bank_name ?? '',
    card_name: row?.card_name ?? '',
    card_type: row?.card_type ?? 'kredi_karti',
    holder_name: row?.holder_name ?? '',
    limit_group_name: row?.limit_group_name ?? '',
    current_balance: row?.current_balance ?? 0,
    credit_limit: row?.credit_limit ?? 0,
    statement_debt_amount: row?.statement_debt_amount ?? row?.debt_amount ?? 0,
    current_period_spending: row?.current_period_spending ?? 0,
    provision_amount: row?.provision_amount ?? 0,
    statement_day: row?.statement_day ?? '',
    due_day: row?.due_day ?? '',
    note: row?.note ?? '',
  }
}

export function mapCardForm(formData: FormData, userId: string, editing: Card | null = null): CardPayload {
  const cardType = formData.get('card_type') as Card['card_type']
  const isCreditCard = cardType === 'kredi_karti'
  const statementDebt = isCreditCard ? parseNumber(formData.get('statement_debt_amount')) : 0
  const currentPeriod = isCreditCard ? parseNumber(formData.get('current_period_spending')) : 0
  const provisionAmount = isCreditCard ? parseNumber(formData.get('provision_amount')) : 0
  const currentBalance = isCreditCard ? 0 : parseNumber(formData.get('current_balance'))
  const cardTypeChanged = Boolean(editing && editing.card_type !== cardType)
  const debtSplitChanged = !editing ||
    !equalsTL(statementDebt, editing.statement_debt_amount) ||
    !equalsTL(currentPeriod, editing.current_period_spending) ||
    !equalsTL(provisionAmount, editing.provision_amount)

  const base = {
    bank_name: String(formData.get('bank_name') ?? ''),
    card_name: String(formData.get('card_name') ?? ''),
    card_type: cardType,
    holder_name: isCreditCard ? String(formData.get('holder_name') ?? '').trim() || null : null,
    limit_group_name: isCreditCard ? String(formData.get('limit_group_name') ?? '').trim() || null : null,
    credit_limit: isCreditCard ? parseNumber(formData.get('credit_limit')) : 0,
    statement_day: isCreditCard ? optionalDay(formData.get('statement_day')) : null,
    due_day: isCreditCard ? optionalDay(formData.get('due_day')) : null,
    note: String(formData.get('note') ?? '') || null,
  }

  if (!editing) {
    return {
      user_id: userId,
      ...base,
      current_balance: currentBalance,
      debt_amount: isCreditCard ? cardSplitTotal(statementDebt, currentPeriod, provisionAmount) : 0,
      statement_debt_amount: statementDebt,
      current_period_spending: currentPeriod,
      provision_amount: provisionAmount,
    }
  }

  const payload: UpdateFor<'cards'> = { ...base }

  if (isCreditCard) {
    if (cardTypeChanged || debtSplitChanged) {
      payload.current_balance = 0
      payload.debt_amount = cardSplitTotal(statementDebt, currentPeriod, provisionAmount)
      payload.statement_debt_amount = statementDebt
      payload.current_period_spending = currentPeriod
      payload.provision_amount = provisionAmount
    }
  } else if (cardTypeChanged) {
    payload.current_balance = currentBalance
    payload.debt_amount = 0
    payload.statement_debt_amount = 0
    payload.current_period_spending = 0
    payload.provision_amount = 0
  } else if (!equalsTL(currentBalance, editing.current_balance)) {
    payload.current_balance = currentBalance
  }

  return payload
}

export function renderCardTitle(row: Card) {
  return row.card_name
}

export function renderCardSubtitle(row: Card) {
  return `${row.bank_name} · ${cardTypeLabel(row.card_type)}`
}

export function renderCardDetails(row: Card) {
  if (row.card_type !== 'kredi_karti') return [`Bakiye: ${formatCurrency(row.current_balance)}`]

  return [
    row.holder_name ? `Kart sahibi: ${row.holder_name}` : 'Kart sahibi: -',
    row.limit_group_name ? `Ortak limit: ${row.limit_group_name}` : 'Ortak limit: -',
    `Limit: ${formatCurrency(row.credit_limit)}`,
    `Toplam borç: ${formatCurrency(row.debt_amount)}`,
    `Ekstre borcu: ${formatCurrency(row.statement_debt_amount)}`,
    `Dönem içi kesinleşen: ${formatCurrency(row.current_period_spending)}`,
    `Provizyon: ${formatCurrency(cardProvisionAmount(row))}`,
    `Ekstre: ${row.statement_day ? `Her ayın ${row.statement_day}. günü` : '-'}`,
    `Son ödeme: ${row.due_day ? `Her ayın ${row.due_day}. günü` : '-'}`,
  ]
}

export function renderCardExtra(row: Card, helpers: { rows: Card[] }) {
  if (row.card_type !== 'kredi_karti' || row.credit_limit <= 0) return null

  const stats = limitGroupStats(row, helpers.rows)
  return (
    <div className="mt-3 rounded-xl border border-border/50 bg-muted/30 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{stats.isShared ? 'Ortak limit kullanımı' : 'Limit kullanımı'}</span>
        <span className="font-mono font-semibold tabular-nums text-foreground">{Math.round(stats.usageRate)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all duration-500"
          style={{ width: `${stats.usageRate}%` }}
        />
      </div>
      {stats.isShared ? (
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground min-[430px]:grid-cols-3">
          <span>Grup borcu: {formatCurrency(stats.totalDebt)}</span>
          <span>Provizyon: {formatCurrency(stats.provisionAmount)}</span>
          <span>Kalan limit: {formatCurrency(stats.availableLimit)}</span>
        </div>
      ) : null}
    </div>
  )
}

export function getCardClassName() {
  return 'border-[hsl(var(--bank-hue)_52%_78%)] bg-[hsl(var(--bank-hue)_58%_98%)] dark:border-[hsl(var(--bank-hue)_42%_34%)] dark:bg-[hsl(var(--bank-hue)_38%_15%)]'
}

export function getDetailClassName() {
  return 'bg-[hsl(var(--bank-hue)_46%_96%)] dark:bg-[hsl(var(--bank-hue)_34%_20%)]'
}

export function getCardStyle(row: Card, rows: Card[]) {
  return bankHueStyle(row.bank_name, rows)
}

export function getDetailStyle(row: Card, rows: Card[]) {
  return bankHueStyle(row.bank_name, rows)
}

export function groupCard(row: Card) {
  return cardGroupLabel(row)
}

export function renderCardRowActions(row: Card, helpers: CardRowsHelper, openTransaction: OpenAccountTransaction) {
  if (row.card_type !== 'banka_karti') return null

  return (
    <button
      type="button"
      onClick={() => openTransaction(row, helpers.reload, helpers.rows)}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97]"
    >
      <ReceiptText size={14} />
      Para hareketi
    </button>
  )
}
