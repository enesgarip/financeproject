import type { CSSProperties } from 'react'
import type { FormField } from '../components/CrudPage'
import type { Card, CardInstallment, CardStatementArchive } from '../types/database'
import { buildCreditLimitGroups, cardPayableDebt, creditLimitGroupKey } from '../utils/financeSummary'
import { daysUntil, nextMonthlyDate } from '../utils/date'
import { roundTL, sumTL } from '../utils/money'
import { normalizeSearchText } from '../utils/searchText'
import { canCutCurrentStatement } from '../utils/statementCycle'

export const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'card_name', label: 'Kart / hesap adı', type: 'text', required: true },
  {
    name: 'holder_name',
    label: 'Kart sahibi',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'card_type',
    label: 'Tür',
    type: 'select',
    options: [
      { label: 'Kredi kartı', value: 'kredi_karti' },
      { label: 'Banka kartı', value: 'banka_karti' },
    ],
  },
  {
    name: 'limit_group_name',
    label: 'Ortak limit grubu',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'credit_limit',
    label: 'Limit / ortak limit',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'statement_debt_amount',
    label: 'Ekstre borcu (ödenecek)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'current_period_spending',
    label: 'Dönem içi kesinleşen',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'provision_amount',
    label: 'Provizyon bekleyen',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'statement_day',
    label: 'Ekstre günü',
    type: 'day',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'due_day',
    label: 'Son ödeme günü',
    type: 'day',
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'account_number',
    label: 'Hesap numarası',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'banka_karti' },
  },
  {
    name: 'iban',
    label: 'IBAN',
    type: 'text',
    visibleWhen: { field: 'card_type', value: 'banka_karti' },
  },
  {
    name: 'current_balance',
    label: 'Bakiye',
    type: 'number',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'banka_karti' },
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

export function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function cardTypeLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartı'
  return 'Banka kartı'
}

export function cardGroupLabel(row: Card) {
  if (row.card_type === 'kredi_karti') return row.limit_group_name?.trim() ? `Ortak limit · ${row.limit_group_name.trim()}` : 'Tekil kredi kartları'
  return 'Banka kartları'
}

function normalizeBankName(bankName: string) {
  return normalizeSearchText(bankName)
}

function bankHue(bankName: string, rows: Card[]) {
  const banks = Array.from(new Set(rows.map((row) => normalizeBankName(row.bank_name)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'tr-TR'),
  )
  const index = Math.max(0, banks.indexOf(normalizeBankName(bankName)))

  return (index * 47 + 196) % 360
}

export function bankHueStyle(bankName: string, rows: Card[]) {
  return { '--bank-hue': String(bankHue(bankName, rows)) } as CSSProperties
}

export function limitGroupKey(card: Card) {
  return creditLimitGroupKey(card)
}

export function limitGroupStats(card: Card, rows: Card[]) {
  const group = buildCreditLimitGroups(rows).find((item) => item.key === limitGroupKey(card))
  const sharedLimit = group?.limit ?? card.credit_limit
  const totalDebt = group?.debt ?? card.debt_amount
  const provisionAmount = group?.provision ?? 0

  return {
    sharedLimit,
    totalDebt,
    provisionAmount,
    availableLimit: Math.max(0, sharedLimit - totalDebt),
    usageRate: sharedLimit > 0 ? Math.min(100, (totalDebt / sharedLimit) * 100) : 0,
    isShared: group?.isShared ?? false,
  }
}

export function statementPeriodLabel(statement: CardStatementArchive) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(statement.period_year, statement.period_month - 1, 1))
}

export type LimitGroupSummary = {
  key: string
  label: string
  bankName: string
  cards: Card[]
  limit: number
  debt: number
  statementDebt: number
  currentPeriod: number
  provision: number
  available: number
  usageRate: number
}

export function buildLimitGroupSummaries(rows: Card[]): LimitGroupSummary[] {
  return buildCreditLimitGroups(rows).map((group) => ({
    ...group,
    bankName: group.cards[0]?.bank_name ?? '',
  }))
}

export type CreditCardStatus = {
  label: string
  description: string
  className: string
}

export function getCreditCardStatus(card: Card, usageRate: number): CreditCardStatus {
  const payableDebt = cardPayableDebt(card)
  const dueDate = nextMonthlyDate(card.due_day)
  const remainingDays = daysUntil(dueDate)

  if (payableDebt > 0 && remainingDays !== null && remainingDays < 0) {
    return {
      label: 'Gecikmiş',
      description: `${Math.abs(remainingDays)} gün geçti`,
      className: 'bg-destructive/12 text-destructive ring-destructive/20',
    }
  }

  if (payableDebt > 0 && remainingDays !== null && remainingDays <= 5) {
    return {
      label: 'Son ödeme yaklaşıyor',
      description: remainingDays === 0 ? 'Bugün' : `${remainingDays} gün kaldı`,
      className: 'bg-warning/12 text-warning ring-warning/20',
    }
  }

  if (usageRate >= 80) {
    return {
      label: 'Limit kullanımı yüksek',
      description: `%${Math.round(usageRate)} kullanım`,
      className: 'bg-warning/12 text-warning ring-warning/20',
    }
  }

  return {
    label: 'Normal',
    description: payableDebt > 0 ? 'Takipte' : 'Ödenebilir borç yok',
    className: 'bg-success/12 text-success ring-success/20',
  }
}

export function formatMonthlyDay(day: number | null | undefined) {
  return day ? `Her ay ${day}` : '-'
}

export function formatShortDate(value: Date | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(value)
}

export function activeInstallmentCount(card: Card, installments: CardInstallment[]) {
  return installments.filter((installment) => installment.card_id === card.id && installment.status !== 'paid').length
}

export function openStatementAmount(card: Card, statements: CardStatementArchive[]) {
  return sumTL(
    statements
      .filter((statement) => statement.card_id === card.id && statement.status === 'open')
      .map((statement) => statement.statement_debt_amount),
  )
}

export function visibleOpenStatementAmount(card: Card, statements: CardStatementArchive[]) {
  const openAmount = openStatementAmount(card, statements)
  return openAmount > 0 ? openAmount : card.statement_debt_amount
}

export function cardOptionLabel(card: Card) {
  const owner = card.holder_name ? ` · ${card.holder_name}` : ''
  return `${card.bank_name} · ${card.card_name}${owner}`
}

export function formatIban(value: string | null | undefined) {
  const cleaned = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return cleaned.replace(/(.{4})/g, '$1 ').trim()
}

export function monthInputValue(value = new Date()) {
  return value.toLocaleDateString('sv-SE').slice(0, 7)
}

export function isMonthValue(month: string) {
  return /^\d{4}-\d{2}$/.test(month)
}

export function monthDateValue(month: string) {
  const safeMonth = isMonthValue(month) ? month : monthInputValue()
  return `${safeMonth}-01`
}

export function addMonthsToMonth(month: string, months: number) {
  const [year, monthIndex] = monthDateValue(month).slice(0, 7).split('-').map(Number)
  if (!year || !monthIndex) return monthDateValue(monthInputValue())

  return new Date(year, monthIndex - 1 + months, 1).toLocaleDateString('sv-SE')
}

export function moneyShare(amount: number, pieces: number) {
  if (amount <= 0) return 0
  return roundTL(amount / Math.max(1, pieces))
}

export function formatMonthLabel(month: string) {
  if (!isMonthValue(month)) return '-'
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${monthDateValue(month)}T00:00:00`))
}

export function parseInstallmentNumber(value: string, fallback: number) {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function shouldRunStatementCut(card: Card, statements: CardStatementArchive[]) {
  return canCutCurrentStatement(card, statements)
}

