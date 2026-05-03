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

const bankTones = [
  { card: 'border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/25', detail: 'bg-sky-50 dark:bg-sky-950/40' },
  { card: 'border-violet-200 bg-violet-50/35 dark:border-violet-900 dark:bg-violet-950/25', detail: 'bg-violet-50 dark:bg-violet-950/40' },
  { card: 'border-rose-200 bg-rose-50/35 dark:border-rose-900 dark:bg-rose-950/25', detail: 'bg-rose-50 dark:bg-rose-950/40' },
  { card: 'border-emerald-200 bg-emerald-50/35 dark:border-emerald-900 dark:bg-emerald-950/25', detail: 'bg-emerald-50 dark:bg-emerald-950/40' },
  { card: 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/25', detail: 'bg-amber-50 dark:bg-amber-950/40' },
  { card: 'border-cyan-200 bg-cyan-50/35 dark:border-cyan-900 dark:bg-cyan-950/25', detail: 'bg-cyan-50 dark:bg-cyan-950/40' },
]

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function cardTypeLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartı'
  return 'Banka kartı'
}

function bankTone(bankName: string) {
  const normalized = bankName.trim().toLocaleLowerCase('tr-TR')
  const total = [...normalized].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return bankTones[total % bankTones.length]
}

export function CardsPage() {
  return (
    <CrudPage
      table="cards"
      addLabel="Kart ekle"
      fields={fields}
      emptyTitle="Henüz kart yok"
      emptyDescription="Kredi kartı, banka kartı ve vadesiz hesaplarını buradan takip edebilirsin."
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
      getCardClassName={(row) => bankTone(row.bank_name).card}
      getDetailClassName={(row) => bankTone(row.bank_name).detail}
    />
  )
}
