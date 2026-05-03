import { CrudPage, type FormField } from '../components/CrudPage'
import type { Debt } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

const fields: FormField[] = [
  { name: 'person_name', label: 'Kişi', type: 'text', required: true },
  {
    name: 'direction',
    label: 'Yön',
    type: 'select',
    options: [
      { label: 'Borç aldım', value: 'borç_aldım' },
      { label: 'Borç verdim', value: 'borç_verdim' },
    ],
  },
  {
    name: 'value_type',
    label: 'Değer türü',
    type: 'select',
    options: [
      { label: 'TRY', value: 'TRY' },
      { label: 'Gram altın', value: 'gram_altin' },
      { label: 'Çeyrek altın', value: 'ceyrek_altin' },
    ],
  },
  { name: 'amount', label: 'Miktar', type: 'number', min: '0', step: '0.01', required: true },
  {
    name: 'estimated_value_try',
    label: 'Tahmini değer (TRY)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
  },
  { name: 'due_date', label: 'Vade tarihi', type: 'date' },
  {
    name: 'status',
    label: 'Durum',
    type: 'select',
    options: [
      { label: 'Açık', value: 'açık' },
      { label: 'Kapandı', value: 'kapandı' },
    ],
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function optionalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? '')
  return date || null
}

function directionLabel(value: Debt['direction']) {
  return value === 'borç_aldım' ? 'Borç aldım' : 'Borç verdim'
}

export function DebtsPage() {
  return (
    <CrudPage
      table="debts"
      addLabel="Borç ekle"
      fields={fields}
      emptyTitle="Henüz borç kaydı yok"
      emptyDescription="Kişisel borçlarını ve alacaklarını sade şekilde takip edebilirsin."
      orderBy="due_date"
      getInitialValues={(row?: Debt) => ({
        person_name: row?.person_name ?? '',
        direction: row?.direction ?? 'borç_aldım',
        value_type: row?.value_type ?? 'TRY',
        amount: row?.amount ?? 0,
        estimated_value_try: row?.estimated_value_try ?? 0,
        due_date: row?.due_date ?? '',
        status: row?.status ?? 'açık',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        person_name: String(formData.get('person_name') ?? ''),
        direction: formData.get('direction') as Debt['direction'],
        value_type: formData.get('value_type') as Debt['value_type'],
        amount: parseNumber(formData.get('amount')),
        estimated_value_try: parseNumber(formData.get('estimated_value_try')),
        due_date: optionalDate(formData.get('due_date')),
        status: formData.get('status') as Debt['status'],
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.person_name}
      renderSubtitle={(row) => `${directionLabel(row.direction)} · ${row.status}`}
      renderDetails={(row) => [
        `Miktar: ${row.amount} ${row.value_type}`,
        `Değer: ${formatCurrency(row.estimated_value_try)}`,
        `Vade: ${formatDate(row.due_date)}`,
      ]}
    />
  )
}
