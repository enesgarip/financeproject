import { CrudPage, type FormField } from '../components/CrudPage'
import { supabase } from '../lib/supabase'
import type { Debt } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'

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
      { label: 'Nakit (TRY)', value: 'TRY' },
      { label: 'Döviz', value: 'doviz' },
      { label: 'Gram altın', value: 'gram_altin' },
      { label: 'Çeyrek altın', value: 'ceyrek_altin' },
    ],
  },
  {
    name: 'currency',
    label: 'Para birimi',
    type: 'select',
    options: [
      { label: 'Dolar (USD)', value: 'USD' },
      { label: 'Euro (EUR)', value: 'EUR' },
      { label: 'Pound (GBP)', value: 'GBP' },
    ],
    visibleWhen: { field: 'value_type', value: 'doviz' },
  },
  {
    name: 'amount',
    label: 'Miktar',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'value_type', value: ['gram_altin', 'ceyrek_altin'] },
  },
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

function valueTypeLabel(row: Debt) {
  if (row.value_type === 'TRY') return 'Nakit'
  if (row.value_type === 'doviz') return `Döviz${row.currency ? ` (${row.currency})` : ''}`
  if (row.value_type === 'gram_altin') return 'Gram altın'
  return 'Çeyrek altın'
}

function isGoldDebt(row: Debt) {
  return row.value_type === 'gram_altin' || row.value_type === 'ceyrek_altin'
}

const debtTone: Record<Debt['direction'], { card: string; detail: string; group: string }> = {
  borç_aldım: {
    card: 'border-rose-200 bg-rose-50/35 dark:border-rose-900 dark:bg-rose-950/25',
    detail: 'bg-rose-50 dark:bg-rose-950/40',
    group: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  },
  borç_verdim: {
    card: 'border-emerald-200 bg-emerald-50/35 dark:border-emerald-900 dark:bg-emerald-950/25',
    detail: 'bg-emerald-50 dark:bg-emerald-950/40',
    group: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
}

async function markDebtAsClosed(debt: Debt, reload: () => Promise<void>, setError: (message: string) => void) {
  const confirmed = window.confirm('Bu borç kaydını kapandı olarak işaretlemek istediğine emin misin?')
  if (!confirmed) return

  const { error } = await supabase
    .from('debts')
    .update({ status: 'kapandı', updated_at: new Date().toISOString() })
    .eq('id', debt.id)

  if (error) {
    setError(error.message)
    return
  }

  await reload()
}

export function DebtsPage() {
  return (
    <CrudPage
      table="debts"
      pageTitle="Borç / Alacak"
      addLabel="Borç ekle"
      fields={fields}
      emptyTitle="Henüz borç kaydı yok"
      emptyDescription="Kişisel borçlarını ve alacaklarını sade şekilde takip edebilirsin."
      orderBy="due_date"
      getInitialValues={(row?: Debt) => ({
        person_name: row?.person_name ?? '',
        direction: row?.direction ?? 'borç_aldım',
        value_type: row?.value_type ?? 'TRY',
        currency: row?.currency ?? 'USD',
        amount: row?.amount ?? 0,
        estimated_value_try: row?.estimated_value_try ?? 0,
        due_date: row?.due_date ?? '',
        status: row?.status ?? 'açık',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => {
        const valueType = formData.get('value_type') as Debt['value_type']
        const isGold = valueType === 'gram_altin' || valueType === 'ceyrek_altin'

        return {
          user_id: userId,
          person_name: String(formData.get('person_name') ?? ''),
          direction: formData.get('direction') as Debt['direction'],
          value_type: valueType,
          currency: valueType === 'doviz' ? (formData.get('currency') as Debt['currency']) : valueType === 'TRY' ? 'TRY' : null,
          amount: isGold ? parseNumber(formData.get('amount')) : 1,
          estimated_value_try: parseNumber(formData.get('estimated_value_try')),
          due_date: optionalDate(formData.get('due_date')),
          status: formData.get('status') as Debt['status'],
          note: String(formData.get('note') ?? '') || null,
        }
      }}
      renderTitle={(row) => row.person_name}
      renderSubtitle={(row) => `${valueTypeLabel(row)} · ${row.status}`}
      renderDetails={(row) => {
        const details = [`Değer: ${formatCurrency(row.estimated_value_try)}`, `Vade: ${formatDate(row.due_date)}`]
        if (isGoldDebt(row)) details.unshift(`Miktar: ${formatNumber(row.amount)} ${valueTypeLabel(row)}`)
        if (row.value_type === 'doviz') details.unshift(`Para birimi: ${row.currency ?? '-'}`)
        return details
      }}
      groupBy={(row) => directionLabel(row.direction)}
      getGroupClassName={(group) => (group === 'Borç aldım' ? debtTone.borç_aldım.group : debtTone.borç_verdim.group)}
      getCardClassName={(row) => debtTone[row.direction].card}
      getDetailClassName={(row) => debtTone[row.direction].detail}
      renderRowActions={(row, helpers) =>
        row.status === 'açık' ? (
          <button
            type="button"
            onClick={() => void markDebtAsClosed(row, helpers.reload, helpers.setError)}
            className="rounded-lg border border-stone-200 bg-stone-700 px-3 py-2 text-xs font-semibold text-white shadow-sm dark:border-stone-700 dark:bg-stone-600"
          >
            Kapandı
          </button>
        ) : null
      }
    />
  )
}
