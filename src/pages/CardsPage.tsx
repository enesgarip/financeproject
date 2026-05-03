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
      { label: 'Banka kartı', value: 'banka_karti' },
      { label: 'Kredi kartı', value: 'kredi_karti' },
      { label: 'Vadesiz hesap', value: 'vadesiz_hesap' },
    ],
  },
  { name: 'current_balance', label: 'Mevcut bakiye', type: 'number', step: '0.01', required: true },
  { name: 'debt_amount', label: 'Borç tutarı', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'statement_day', label: 'Ekstre günü', type: 'day' },
  { name: 'due_day', label: 'Son ödeme günü', type: 'day' },
  { name: 'note', label: 'Not', type: 'textarea' },
]

const bankTones = [
  { card: 'border-sky-200 bg-sky-50/40', detail: 'bg-sky-50' },
  { card: 'border-violet-200 bg-violet-50/35', detail: 'bg-violet-50' },
  { card: 'border-rose-200 bg-rose-50/35', detail: 'bg-rose-50' },
  { card: 'border-emerald-200 bg-emerald-50/35', detail: 'bg-emerald-50' },
  { card: 'border-amber-200 bg-amber-50/40', detail: 'bg-amber-50' },
  { card: 'border-cyan-200 bg-cyan-50/35', detail: 'bg-cyan-50' },
]

function optionalDay(value: FormDataEntryValue | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function cardTypeLabel(value: Card['card_type']) {
  if (value === 'kredi_karti') return 'Kredi kartı'
  if (value === 'banka_karti') return 'Banka kartı'
  return 'Vadesiz hesap'
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
        debt_amount: row?.debt_amount ?? 0,
        statement_day: row?.statement_day ?? '',
        due_day: row?.due_day ?? '',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        bank_name: String(formData.get('bank_name') ?? ''),
        card_name: String(formData.get('card_name') ?? ''),
        card_type: formData.get('card_type') as Card['card_type'],
        current_balance: parseNumber(formData.get('current_balance')),
        debt_amount: parseNumber(formData.get('debt_amount')),
        statement_day: optionalDay(formData.get('statement_day')),
        due_day: optionalDay(formData.get('due_day')),
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.card_name}
      renderSubtitle={(row) => `${row.bank_name} · ${cardTypeLabel(row.card_type)}`}
      renderDetails={(row) => [
        `Bakiye: ${formatCurrency(row.current_balance)}`,
        `Borç: ${formatCurrency(row.debt_amount)}`,
        `Ekstre: ${row.statement_day ?? '-'}`,
        `Son ödeme: ${row.due_day ?? '-'}`,
      ]}
      getCardClassName={(row) => bankTone(row.bank_name).card}
      getDetailClassName={(row) => bankTone(row.bank_name).detail}
    />
  )
}
