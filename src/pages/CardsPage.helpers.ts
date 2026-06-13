import type { CSSProperties } from 'react'
import type { FormField } from '../components/CrudPage'
import type { Card, CardStatementArchive } from '../types/database'
import { buildCreditLimitGroups, creditLimitGroupKey } from '../utils/financeSummary'
import { isMissingSupabaseCapabilityError } from '../utils/supabaseErrors'

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
  return bankName.trim().toLocaleLowerCase('tr-TR')
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

export function isSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  return isMissingSupabaseCapabilityError(error)
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

