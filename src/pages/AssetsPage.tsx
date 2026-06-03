import { ArrowDownRight, ArrowUpRight, Banknote, Coins, Landmark, LineChart, Minus, PiggyBank, TrendingUp, Wallet } from 'lucide-react'
import type { ComponentType } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import type { Asset, SalaryHistory } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'

const categoryOptions: Asset['category'][] = ['Nakit', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer']

/* Category → colour + icon mapping driven by design tokens */
const categoryMeta: Record<Asset['category'], { color: string; icon: ComponentType<{ className?: string }> }> = {
  Nakit: { color: 'var(--success)',     icon: Banknote },
  Altın: { color: 'var(--warning)',     icon: Coins },
  Fon:   { color: 'var(--info)',        icon: LineChart },
  Hisse: { color: 'var(--primary)',     icon: TrendingUp },
  Araç:  { color: '#fb923c',            icon: Wallet },
  BES:   { color: '#2dd4bf',            icon: PiggyBank },
  Diğer: { color: 'var(--muted-foreground)', icon: Landmark },
}

/* Soft tinted card backgrounds per category (token-based, dark-safe) */
const categoryCardTint: Record<Asset['category'], string> = {
  Nakit: 'border-success/20 bg-success/5 dark:bg-success/8',
  Altın: 'border-warning/20 bg-warning/5 dark:bg-warning/8',
  Fon:   'border-info/20 bg-info/5 dark:bg-info/8',
  Hisse: 'border-primary/20 bg-primary/5 dark:bg-primary/8',
  Araç:  'border-orange-300/30 bg-orange-50/40 dark:border-orange-900/40 dark:bg-orange-950/15',
  BES:   'border-teal-300/30 bg-teal-50/40 dark:border-teal-900/40 dark:bg-teal-950/15',
  Diğer: 'border-border/70 bg-card',
}

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
  const topCategory = categoryTotals[0]

  const donutData: DonutSlice[] = categoryTotals.map((item) => ({
    name: item.category,
    value: item.total,
    color: categoryMeta[item.category].color,
  }))

  return (
    <Card variant="elevated" className="overflow-hidden border-primary/15">
      {/* Top accent line */}
      <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-success via-primary to-warning opacity-80" />
      <CardContent className="p-4 sm:p-5">
        <div className="grid gap-5 sm:grid-cols-[1.1fr_1fr] sm:items-center">
          {/* Left: total + highlights */}
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="finance-label">Toplam Varlık</p>
                <p className="finance-value mt-1.5 text-[clamp(1.75rem,7vw,2.5rem)] font-bold leading-none text-foreground">
                  {formatCurrency(total)}
                </p>
              </div>
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <Wallet className="size-5" />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="finance-label truncate">Nakit</p>
                <p className="finance-value mt-1 truncate text-sm font-bold text-success">{formatCurrency(cashTotal)}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="finance-label truncate">En Büyük Kalem</p>
                <p className="finance-value mt-1 truncate text-sm font-bold text-foreground">
                  {topCategory ? topCategory.category : '—'}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Badge variant="secondary">{rows.length} kayıt</Badge>
              <Badge variant="outline">{categoryTotals.length} kategori</Badge>
            </div>
          </div>

          {/* Right: donut composition */}
          <div className="min-w-0">
            <DonutChart data={donutData} size={170} innerRadius={48} totalLabel="Varlık" />
          </div>
        </div>
      </CardContent>
    </Card>
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
  const isUp = difference > 0
  const isDown = difference < 0
  const DeltaIcon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus
  const deltaColor = isUp ? 'text-success' : isDown ? 'text-destructive' : 'text-muted-foreground'

  return (
    <Card variant="default" className="overflow-hidden border-success/20">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Güncel Maaş</p>
            <p className="finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none text-foreground">
              {formatCurrency(current.amount)}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{formatDate(current.effective_date)}</p>
          </div>
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
            <TrendingUp className="size-5" />
          </div>
        </div>

        {previous ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">Önceki kayda göre</span>
            <span className={`flex items-center gap-1 font-mono text-sm font-semibold tabular-nums ${deltaColor}`}>
              <DeltaIcon size={14} />
              {difference >= 0 ? '+' : ''}{formatCurrency(difference)}
              <span className="ml-1 text-xs">({percentage >= 0 ? '+' : ''}{percentage.toFixed(1)}%)</span>
            </span>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            İlk maaş kaydı — sonraki kayıtlarda artış trendi burada görünecek.
          </div>
        )}
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
        getCardClassName={(row) => categoryCardTint[row.category]}
        getDetailClassName={() => 'bg-muted/40'}
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
          const isUp = difference >= 0
          return (
            <div className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${isUp ? 'border-success/20 bg-success/8 text-success' : 'border-destructive/20 bg-destructive/8 text-destructive'}`}>
              {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              <span className="font-mono font-semibold tabular-nums">
                {difference >= 0 ? '+' : ''}{formatCurrency(difference)} ({percentage >= 0 ? '+' : ''}{percentage.toFixed(1)}%)
              </span>
            </div>
          )
        }}
        getCardClassName={() => 'border-success/20 bg-success/5 dark:bg-success/8'}
        getDetailClassName={() => 'bg-muted/40'}
      />
    </div>
  )
}
