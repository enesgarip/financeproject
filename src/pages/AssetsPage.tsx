import { CrudPage, type FormField } from '../components/CrudPage'
import type { Asset } from '../types/database'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

const fields: FormField[] = [
  { name: 'name', label: 'Ad', type: 'text', required: true },
  {
    name: 'category',
    label: 'Kategori',
    type: 'select',
    options: ['Nakit', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer'].map((value) => ({
      label: value,
      value,
    })),
  },
  { name: 'amount', label: 'Miktar', type: 'number', min: '0', step: '0.01', required: true },
  {
    name: 'unit',
    label: 'Birim',
    type: 'select',
    options: ['TRY', 'gram', 'adet'].map((value) => ({ label: value, value })),
  },
  {
    name: 'estimated_value_try',
    label: 'Tahmini değer (TRY)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

export function AssetsPage() {
  return (
    <CrudPage
      table="assets"
      addLabel="Varlık ekle"
      fields={fields}
      emptyTitle="Henüz varlık yok"
      emptyDescription="Nakit, altın, fon, hisse veya diğer varlıklarını buradan ekleyebilirsin."
      getInitialValues={(row?: Asset) => ({
        name: row?.name ?? '',
        category: row?.category ?? 'Nakit',
        amount: row?.amount ?? 0,
        unit: row?.unit ?? 'TRY',
        estimated_value_try: row?.estimated_value_try ?? 0,
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        name: String(formData.get('name') ?? ''),
        category: formData.get('category') as Asset['category'],
        amount: parseNumber(formData.get('amount')),
        unit: formData.get('unit') as Asset['unit'],
        estimated_value_try: parseNumber(formData.get('estimated_value_try')),
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.name}
      renderSubtitle={(row) => row.category}
      renderDetails={(row) => [
        `Miktar: ${row.amount} ${row.unit}`,
        `Değer: ${formatCurrency(row.estimated_value_try)}`,
      ]}
    />
  )
}
