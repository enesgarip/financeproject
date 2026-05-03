import type { CSSProperties } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import type { Card } from '../types/database'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

const fields: FormField[] = [
  { name: 'bank_name', label: 'Banka', type: 'text', required: true },
  { name: 'card_name', label: 'Kart / hesap adı', type: 'text', required: true },
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
    name: 'credit_limit',
    label: 'Limit',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'card_type', value: 'kredi_karti' },
  },
  {
    name: 'debt_amount',
    label: 'Borç tutarı',
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

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function cardTypeLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartı'
  return 'Banka kartı'
}

function cardGroupLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartları'
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

function bankHueStyle(bankName: string, rows: Card[]) {
  return { '--bank-hue': String(bankHue(bankName, rows)) } as CSSProperties
}

export function CardsPage() {
  return (
    <CrudPage
      table="cards"
      addLabel="Kart ekle"
      fields={fields}
      emptyTitle="Henüz kart yok"
      emptyDescription="Kredi kartı ve banka kartlarını buradan takip edebilirsin."
      orderBy="card_type"
      getInitialValues={(row?: Card) => ({
        bank_name: row?.bank_name ?? '',
        card_name: row?.card_name ?? '',
        card_type: row?.card_type ?? 'kredi_karti',
        current_balance: row?.current_balance ?? 0,
        credit_limit: row?.credit_limit ?? 0,
        debt_amount: row?.debt_amount ?? 0,
        statement_day: row?.statement_day ?? '',
        due_day: row?.due_day ?? '',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => {
        const cardType = formData.get('card_type') as Card['card_type']
        const isCreditCard = cardType === 'kredi_karti'

        return {
          user_id: userId,
          bank_name: String(formData.get('bank_name') ?? ''),
          card_name: String(formData.get('card_name') ?? ''),
          card_type: cardType,
          current_balance: isCreditCard ? 0 : parseNumber(formData.get('current_balance')),
          credit_limit: isCreditCard ? parseNumber(formData.get('credit_limit')) : 0,
          debt_amount: isCreditCard ? parseNumber(formData.get('debt_amount')) : 0,
          statement_day: isCreditCard ? optionalDay(formData.get('statement_day')) : null,
          due_day: isCreditCard ? optionalDay(formData.get('due_day')) : null,
          note: String(formData.get('note') ?? '') || null,
        }
      }}
      renderTitle={(row) => row.card_name}
      renderSubtitle={(row) => `${row.bank_name} · ${cardTypeLabel(row.card_type)}`}
      renderDetails={(row) =>
        row.card_type === 'kredi_karti'
          ? [
              `Limit: ${formatCurrency(row.credit_limit)}`,
              `Borç: ${formatCurrency(row.debt_amount)}`,
              `Ekstre: ${row.statement_day ?? '-'}`,
              `Son ödeme: ${row.due_day ?? '-'}`,
            ]
          : [`Bakiye: ${formatCurrency(row.current_balance)}`]
      }
      getCardClassName={() =>
        'border-[hsl(var(--bank-hue)_72%_74%)] bg-[hsl(var(--bank-hue)_88%_97%)] dark:border-[hsl(var(--bank-hue)_48%_38%)] dark:bg-[hsl(var(--bank-hue)_55%_16%)]'
      }
      getDetailClassName={() => 'bg-[hsl(var(--bank-hue)_88%_94%)] dark:bg-[hsl(var(--bank-hue)_50%_22%)]'}
      getCardStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
      getDetailStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
      groupBy={(row) => cardGroupLabel(row.card_type)}
      getGroupClassName={() =>
        'border-b border-stone-200 bg-transparent px-0 pb-2 pt-1 text-stone-500 dark:border-stone-800 dark:bg-transparent dark:text-stone-400'
      }
    />
  )
}
