import { CrudPage, type FormField } from '../components/CrudPage'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import type { Asset, SalaryHistory } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'

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
    name: 'currency',
    label: 'Para birimi',
    type: 'select',
    options: [
      { label: 'Türk lirası (TRY)', value: 'TRY' },
      { label: 'Dolar (USD)', value: 'USD' },
      { label: 'Euro (EUR)', value: 'EUR' },
      { label: 'Pound (GBP)', value: 'GBP' },
    ],
    visibleWhen: { field: 'category', value: 'Nakit' },
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

const salaryFields: FormField[] = [
  { name: 'title', label: 'Başlık', type: 'text', required: true },
  { name: 'amount', label: 'Net maaş', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'effective_date', label: 'Geçerli olduğu tarih', type: 'date', required: true },
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

function AssetsOverview({ rows }: { rows: Asset[] }) {
  if (rows.length === 0) return null

  const total = rows.reduce((sum, row) => sum + row.estimated_value_try, 0)
  const categoryTotals = categoryOptions
    .map((category) => ({
      category,
      total: rows.filter((row) => row.category === category).reduce((sum, row) => sum + row.estimated_value_try, 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)
  const cashTotal = categoryTotals.find((item) => item.category === 'Nakit')?.total ?? 0

  return (
    <div className="flex flex-col gap-3">
      <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-muted-foreground">Varlık kompozisyonu</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{formatCurrency(total)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Nakit {formatCurrency(cashTotal)}</p>
            </div>
            <Badge variant="secondary">{rows.length} kayıt</Badge>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {categoryTotals.slice(0, 5).map((item) => {
              const rate = total > 0 ? Math.min(100, (item.total / total) * 100) : 0
              return (
                <div key={item.category}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-foreground">{item.category}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(item.total)}</span>
                  </div>
                  <Progress value={rate} className="h-1.5" />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SalaryOverview({ rows }: { rows: SalaryHistory[] }) {
  if (rows.length === 0) return null

  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  const current = ordered.at(-1)
  const previous = ordered.at(-2)
  if (!current) return null

  const difference = previous ? current.amount - previous.amount : 0
  const percentage = previous && previous.amount > 0 ? (difference / previous.amount) * 100 : 0

  return (
    <Card className="border-0 shadow-sm ring-1 ring-emerald-200/80 dark:ring-emerald-900">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-muted-foreground">Maaş trendi</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{formatCurrency(current.amount)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{formatDate(current.effective_date)}</p>
          </div>
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            {previous ? `${difference >= 0 ? '+' : ''}${percentage.toFixed(1)}%` : 'İlk kayıt'}
          </Badge>
        </div>
        {previous ? (
          <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
            Önceki kayda göre {difference >= 0 ? '+' : ''}
            {formatCurrency(difference)}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function AssetsPage() {
  return (
    <div className="space-y-8">
      <CrudPage
        table="assets"
        pageTitle="Varlıklar"
        addLabel="Varlık ekle"
        fields={fields}
        emptyTitle="Henüz varlık yok"
        emptyDescription="Nakit, altın, fon, hisse veya diğer varlıklarını buradan ekleyebilirsin."
        renderBeforeList={({ loading, rows }) => (!loading ? <AssetsOverview rows={rows as Asset[]} /> : null)}
        getInitialValues={(row?: Asset) => ({
          name: row?.name ?? '',
          category: row?.category ?? 'Nakit',
          amount: row?.amount ?? 0,
          unit: row?.unit === 'TRY' ? 'gram' : (row?.unit ?? 'gram'),
          currency: row?.currency ?? 'TRY',
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
            currency: category === 'Nakit' ? (formData.get('currency') as Asset['currency']) : null,
            estimated_value_try: parseNumber(formData.get('estimated_value_try')),
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.name}
        renderSubtitle={(row) => row.category}
        renderDetails={(row) => {
          const details = [`Değer: ${formatCurrency(row.estimated_value_try)}`]
          if (row.category === 'Altın') details.unshift(`Miktar: ${formatNumber(row.amount)} ${row.unit}`)
          if (row.category === 'Nakit') details.unshift(`Para birimi: ${row.currency ?? 'TRY'}`)
          return details
        }}
        getCardClassName={(row) => assetTone[row.category].card}
        getDetailClassName={(row) => assetTone[row.category].detail}
        groupBy={(row) => row.category}
      />

      <CrudPage
        table="salary_history"
        pageTitle="Maaş geçmişi"
        addLabel="Maaş ekle"
        fields={salaryFields}
        emptyTitle="Henüz maaş kaydı yok"
        emptyDescription="Maaşını varlık hesaplarına katmadan tarihsel artışını buradan takip edebilirsin."
        orderBy="effective_date"
        orderAscending={false}
        renderBeforeList={({ loading, rows }) => (!loading ? <SalaryOverview rows={rows as SalaryHistory[]} /> : null)}
        getInitialValues={(row?: SalaryHistory) => ({
          title: row?.title ?? 'Maaş',
          amount: row?.amount ?? 0,
          effective_date: row?.effective_date ?? new Date().toLocaleDateString('sv-SE'),
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => ({
          user_id: userId,
          title: String(formData.get('title') ?? '').trim() || 'Maaş',
          amount: parseNumber(formData.get('amount')),
          effective_date: String(formData.get('effective_date') ?? ''),
          note: String(formData.get('note') ?? '') || null,
        })}
        renderTitle={(row) => row.title}
        renderSubtitle={(row) => formatDate(row.effective_date)}
        renderDetails={(row) => [`Net maaş: ${formatCurrency(row.amount)}`]}
        renderExtra={(row, helpers) => {
          const orderedRows = [...(helpers.rows as SalaryHistory[])].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
          const index = orderedRows.findIndex((item) => item.id === row.id)
          const previous = index > 0 ? orderedRows[index - 1] : null
          if (!previous || previous.amount <= 0) return null

          const difference = row.amount - previous.amount
          const percentage = (difference / previous.amount) * 100
          return (
            <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              Önceki kayda göre {difference >= 0 ? '+' : ''}
              {formatCurrency(difference)} ({percentage >= 0 ? '+' : ''}
              {percentage.toFixed(1)}%)
            </div>
          )
        }}
        getCardClassName={() => 'border-emerald-200 bg-emerald-50/35 dark:border-emerald-900 dark:bg-emerald-950/25'}
        getDetailClassName={() => 'bg-emerald-50 dark:bg-emerald-950/40'}
      />
    </div>
  )
}
