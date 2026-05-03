import { CrudPage, type FormField } from '../components/CrudPage'
import type { Asset } from '../types/database'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'

const categoryOptions: Asset['category'][] = ['Nakit', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer']

const fields: FormField[] = [
  { name: 'name', label: 'Ad', type: 'text', required: true },
  {
    name: 'category',
    label: 'Kategori',
    type: 'select',
    options: categoryOptions.map((value) => ({ label: value, value })),
  },
  {
    name: 'amount',
    label: 'Altın miktarı',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'category', value: 'Altın' },
  },
  {
    name: 'unit',
    label: 'Altın birimi',
    type: 'select',
    options: [
      { label: 'Gram', value: 'gram' },
      { label: 'Adet', value: 'adet' },
    ],
    visibleWhen: { field: 'category', value: 'Altın' },
  },
  {
    name: 'estimated_value_try',
    label: 'Toplam değer (TRY)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

const assetTone: Record<Asset['category'], { card: string; detail: string }> = {
  Nakit: { card: 'border-emerald-200 bg-emerald-50/35 dark:border-emerald-900 dark:bg-emerald-950/25', detail: 'bg-emerald-50 dark:bg-emerald-950/40' },
  Altın: { card: 'border-amber-200 bg-amber-50/45 dark:border-amber-900 dark:bg-amber-950/25', detail: 'bg-amber-50 dark:bg-amber-950/40' },
  Fon: { card: 'border-sky-200 bg-sky-50/40 dark:border-sky-900 dark:bg-sky-950/25', detail: 'bg-sky-50 dark:bg-sky-950/40' },
  Hisse: { card: 'border-indigo-200 bg-indigo-50/35 dark:border-indigo-900 dark:bg-indigo-950/25', detail: 'bg-indigo-50 dark:bg-indigo-950/40' },
  Araç: { card: 'border-orange-200 bg-orange-50/35 dark:border-orange-900 dark:bg-orange-950/25', detail: 'bg-orange-50 dark:bg-orange-950/40' },
  BES: { card: 'border-teal-200 bg-teal-50/35 dark:border-teal-900 dark:bg-teal-950/25', detail: 'bg-teal-50 dark:bg-teal-950/40' },
  Diğer: { card: 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900', detail: 'bg-stone-50 dark:bg-stone-800' },
}

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
        unit: row?.unit === 'TRY' ? 'gram' : (row?.unit ?? 'gram'),
        estimated_value_try: row?.estimated_value_try ?? 0,
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => {
        const category = formData.get('category') as Asset['category']
        const isGold = category === 'Altın'

        return {
          user_id: userId,
          name: String(formData.get('name') ?? ''),
          category,
          amount: isGold ? parseNumber(formData.get('amount')) : 1,
          unit: isGold ? (formData.get('unit') as Asset['unit']) : 'TRY',
          estimated_value_try: parseNumber(formData.get('estimated_value_try')),
          note: String(formData.get('note') ?? '') || null,
        }
      }}
      renderTitle={(row) => row.name}
      renderSubtitle={(row) => row.category}
      renderDetails={(row) => {
        const details = [`Değer: ${formatCurrency(row.estimated_value_try)}`]
        if (row.category === 'Altın') details.unshift(`Miktar: ${row.amount} ${row.unit}`)
        return details
      }}
      getCardClassName={(row) => assetTone[row.category].card}
      getDetailClassName={(row) => assetTone[row.category].detail}
    />
  )
}
