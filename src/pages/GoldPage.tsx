import { Coins, LineChart, Scale, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '../auth/useAuth'
import { CrudPage, type FormField } from '../components/CrudPage'
import { useChartWidth } from '../components/charts/useChartWidth'
import { RatesBanner } from '../components/finance/RatesBanner'
import { MetricCard, SectionHeader } from '../components/finance/FinanceUI'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { useMarketRates } from '../hooks/useMarketRates'
import type { GoldLot, GoldType } from '../types/database'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'
import {
  GOLD_TYPE_LABELS,
  GOLD_TYPE_UNIT,
  summarizeGold,
  type GoldTypeSummary,
} from '../utils/goldLedger'
import { syncGoldLedgerAssets } from '../utils/goldLedgerSync'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, roundTL as round2, sumTL } from '../utils/money'
import { valueAsset } from '../utils/valuation'

const goldFields: FormField[] = [
  { name: 'purchase_date', label: 'Alım tarihi', type: 'date' },
  {
    name: 'gold_type',
    label: 'Tür',
    type: 'select',
    options: [
      { label: 'Gram altın', value: 'gram' },
      { label: 'Çeyrek altın', value: 'ceyrek' },
    ],
  },
  {
    name: 'ayar',
    label: 'Ayar',
    type: 'number',
    min: '0',
    step: '1',
    hint: () => 'Bilgi amaçlı; gram için genelde 24, çeyrek için 22.',
  },
  {
    name: 'quantity',
    label: 'Miktar',
    type: 'number',
    min: '0.0001',
    step: '0.0001',
    required: true,
  },
  {
    name: 'unit_price',
    label: 'Birim maliyet (₺)',
    type: 'number',
    min: '0',
    step: '0.01',
    hint: () => 'Boş bırakırsan adet sayılır, maliyet ortalamasına katılmaz.',
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

type ChartPoint = {
  date: string
  label: string
  gram: number
  ceyrek: number
  cost: number
  market: number | null
}

type TooltipPayload = {
  dataKey: string
  name: string
  value: number | null
  stroke?: string
}


function formatDate(value: string | null): string {
  if (!value) return 'Tarih bilinmiyor'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatQuantity(value: number, type: GoldType): string {
  return `${formatNumber(value)} ${type === 'gram' ? 'gr' : 'adet'}`
}

function optionalNumber(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim()
  return raw ? parseNumber(raw) : null
}

function goldValue(type: GoldType, quantity: number, snapshot: MarketRatesSnapshot | null): number | null {
  if (quantity <= 0) return 0
  return valueAsset(
    {
      category: 'Altın',
      unit: GOLD_TYPE_UNIT[type],
      currency: null,
      amount: quantity,
    },
    snapshot,
  )
}

function sumGoldValues(
  summaries: GoldTypeSummary[],
  snapshot: MarketRatesSnapshot | null,
  quantity: 'totalQuantity' | 'knownQuantity',
): number | null {
  const values: number[] = []
  for (const summary of summaries) {
    const value = goldValue(summary.goldType, summary[quantity], snapshot)
    if (value === null) return null
    values.push(value)
  }
  return sumTL(values)
}

function buildChartData(lots: GoldLot[], snapshot: MarketRatesSnapshot | null): ChartPoint[] {
  const dated = lots
    .filter((lot) => lot.purchase_date)
    .sort((a, b) => String(a.purchase_date).localeCompare(String(b.purchase_date)))

  let gram = 0
  let ceyrek = 0
  let cost = 0

  return dated.map((lot) => {
    if (lot.gold_type === 'gram') gram += lot.quantity
    if (lot.gold_type === 'ceyrek') ceyrek += lot.quantity
    if (lot.unit_price != null) cost = sumTL([cost, lot.quantity * lot.unit_price])

    const gramValue = goldValue('gram', gram, snapshot)
    const ceyrekValue = goldValue('ceyrek', ceyrek, snapshot)

    return {
      date: String(lot.purchase_date),
      label: formatDate(lot.purchase_date),
      gram: round2(gram),
      ceyrek: round2(ceyrek),
      cost: round2(cost),
      market: gramValue === null || ceyrekValue === null ? null : sumTL([gramValue, ceyrekValue]),
    }
  })
}

function GoldLedgerAssetSync({
  rows,
  loading,
  snapshot,
  setError,
}: {
  rows: GoldLot[]
  loading: boolean
  snapshot: MarketRatesSnapshot | null
  setError: (message: string) => void
}) {
  const { user } = useAuth()
  const lastSyncKey = useRef('')
  const hasSeenLots = useRef(false)
  const rowsKey = useMemo(
    () =>
      rows
        .map((row) => [row.id, row.purchase_date, row.gold_type, row.ayar, row.quantity, row.unit_price, row.note].join(':'))
        .join('|'),
    [rows],
  )
  const ratesKey = snapshot?.asOf ?? snapshot?.fetchedAt ?? 'no-rates'

  useEffect(() => {
    if (loading || !user) return
    if (rows.length === 0 && !hasSeenLots.current) return
    if (rows.length > 0) hasSeenLots.current = true

    const syncKey = `${rowsKey}::${ratesKey}`
    if (lastSyncKey.current === syncKey) return
    lastSyncKey.current = syncKey

    void syncGoldLedgerAssets(rows, user.id, snapshot)
      .then(() => {
        if (rows.length === 0) hasSeenLots.current = false
      })
      .catch((error: unknown) => {
        const message = typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'Altın defteri varlık senkronu tamamlanamadı.'
        setError(message)
      })
  }, [loading, ratesKey, rows, rowsKey, setError, snapshot, user])

  return null
}

function GoldOverview({ rows, snapshot }: { rows: GoldLot[]; snapshot: MarketRatesSnapshot | null }) {
  const summaries = useMemo(() => summarizeGold(rows), [rows])
  if (summaries.length === 0) return null

  const totalKnownCost = sumTL(summaries.map((summary) => summary.knownCost))
  const totalLiveValue = sumGoldValues(summaries, snapshot, 'totalQuantity')
  const knownLiveValue = sumGoldValues(summaries, snapshot, 'knownQuantity')
  const profit = knownLiveValue === null || totalKnownCost <= 0 ? null : diffTL(knownLiveValue, totalKnownCost)
  const profitPct = profit === null || totalKnownCost <= 0 ? null : round2((profit / totalKnownCost) * 100)
  const totalValueLabel = totalLiveValue === null ? 'Kur bekleniyor' : formatCurrency(totalLiveValue)
  const gramSummary = summaries.find((summary) => summary.goldType === 'gram')
  const ceyrekSummary = summaries.find((summary) => summary.goldType === 'ceyrek')
  const unknownSummaries = summaries.filter((summary) => summary.unknownQuantity > 0)

  return (
    <div className="space-y-3">
      <div className="grid gap-3 min-[680px]:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Güncel değer"
          value={totalValueLabel}
          description="canlı alış kuruyla"
          tone="premium"
          icon={TrendingUp}
        />
        <MetricCard
          label="Toplam maliyet"
          value={formatCurrency(totalKnownCost)}
          description="maliyeti kayıtlı alımlar"
          tone="neutral"
          icon={Coins}
        />
        <MetricCard
          label="Kâr / zarar"
          value={profit === null ? 'Kur bekleniyor' : `${profit >= 0 ? '+' : ''}${formatCurrency(profit)}`}
          delta={profitPct === null ? undefined : `${profitPct >= 0 ? '+' : ''}%${profitPct.toFixed(1)}`}
          deltaLabel={profit === null ? 'flat' : profit > 0 ? 'up' : profit < 0 ? 'down' : 'flat'}
          description="kayıtlı maliyet üzerinden"
          tone={profit === null ? 'neutral' : profit >= 0 ? 'good' : 'danger'}
          icon={LineChart}
        />
        <MetricCard
          label="Birikim"
          value={[
            gramSummary ? formatQuantity(gramSummary.totalQuantity, 'gram') : null,
            ceyrekSummary ? formatQuantity(ceyrekSummary.totalQuantity, 'ceyrek') : null,
          ].filter(Boolean).join(' · ')}
          description={`${rows.length} işlem`}
          tone="info"
          icon={Scale}
        />
      </div>

      {unknownSummaries.length > 0 ? (
        <Alert variant="warning">
          {unknownSummaries
            .map((summary) => `${formatQuantity(summary.unknownQuantity, summary.goldType)} maliyeti kayıtsız`)
            .join(' · ')}
          . Adet toplamda sayılıyor; ortalama maliyet ve kâr/zarar sadece maliyeti kayıtlı işlemlerden hesaplanıyor.
        </Alert>
      ) : null}
    </div>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null

  return (
    <div className="min-w-[180px] rounded-xl border border-border/70 bg-card p-3 shadow-[var(--shadow-floating)]">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      {payload
        .filter((entry) => entry.value != null)
        .map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: entry.stroke }} />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {formatCurrency(entry.value)}
            </span>
          </div>
        ))}
    </div>
  )
}

function GoldAccumulationChart({ rows, snapshot }: { rows: GoldLot[]; snapshot: MarketRatesSnapshot | null }) {
  const data = useMemo(() => buildChartData(rows, snapshot), [rows, snapshot])
  const [chartRef, chartWidth] = useChartWidth()
  const undatedCount = rows.filter((row) => !row.purchase_date).length
  const hasMarket = data.some((point) => point.market !== null)

  return (
    <Card variant="elevated" className="border-warning/20">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <SectionHeader
            title="Birikim grafiği"
            description="Tarihli işlemlerde kayıtlı maliyet ve canlı piyasa değeri."
          />
          {undatedCount > 0 ? <Badge variant="warning">{undatedCount} tarihsiz işlem grafikte yok</Badge> : null}
        </div>

        {data.length === 0 ? (
          <div className="flex h-52 items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            Tarihli işlem yok
          </div>
        ) : (
          <div ref={chartRef} className="min-w-0" style={{ height: 260, minHeight: 260 }}>
            {chartWidth > 0 ? (
              <ReLineChart width={chartWidth} height={260} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  dy={8}
                />
                <YAxis
                  width={66}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value: number) => (value >= 1000 ? `₺${(value / 1000).toFixed(0)}K` : `₺${value}`)}
                />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip content={<ChartTooltip /> as any} cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.25 }} />
                <Line
                  type="monotone"
                  dataKey="cost"
                  name="Bilinen maliyet"
                  stroke="var(--warning)"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                {hasMarket ? (
                  <Line
                    type="monotone"
                    dataKey="market"
                    name="Piyasa değeri"
                    stroke="var(--success)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ) : null}
              </ReLineChart>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function validateGoldLot(formData: FormData): Record<string, string> {
  const errors: Record<string, string> = {}
  const quantity = parseNumber(formData.get('quantity'))
  if (quantity <= 0) errors.quantity = 'Miktar 0’dan büyük olmalı.'
  return errors
}

export function GoldPage() {
  const { snapshot } = useMarketRates()

  return (
    <CrudPage
      table="gold_lots"
      pageTitle="Altın"
      addLabel="İşlem ekle"
      fields={goldFields}
      orderBy="purchase_date"
      orderAscending={false}
      emptyTitle="Henüz altın işlemi yok"
      emptyDescription="Gram veya çeyrek alımlarını işlem olarak ekleyince toplam adet, ortalama maliyet ve net değer otomatik güncellenir."
      validateForm={validateGoldLot}
      getInitialValues={(row?: GoldLot) => ({
        purchase_date: row?.purchase_date ?? '',
        gold_type: row?.gold_type ?? 'gram',
        ayar: row?.ayar ?? '',
        quantity: row?.quantity ?? 1,
        unit_price: row?.unit_price ?? '',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        purchase_date: String(formData.get('purchase_date') ?? '') || null,
        gold_type: formData.get('gold_type') as GoldType,
        ayar: optionalNumber(formData, 'ayar'),
        quantity: parseNumber(formData.get('quantity')),
        unit_price: optionalNumber(formData, 'unit_price'),
        note: String(formData.get('note') ?? '') || null,
      })}
      renderBeforeList={({ loading, rows, reload, setError }) => {
        const goldRows = rows as GoldLot[]
        return (
          <div className="space-y-3">
            <GoldLedgerAssetSync rows={goldRows} loading={loading} snapshot={snapshot} setError={setError} />
            <RatesBanner onSynced={reload} />
            {!loading ? <GoldOverview rows={goldRows} snapshot={snapshot} /> : null}
            {!loading ? <GoldAccumulationChart rows={goldRows} snapshot={snapshot} /> : null}
          </div>
        )
      }}
      renderTitle={(row) => GOLD_TYPE_LABELS[row.gold_type]}
      renderSubtitle={(row) => formatDate(row.purchase_date)}
      renderDetails={(row) => {
        const totalCost = row.unit_price == null ? null : round2(row.quantity * row.unit_price)
        return [
          `Miktar: ${formatQuantity(row.quantity, row.gold_type)}`,
          `Birim maliyet: ${row.unit_price == null ? 'Maliyet bilinmiyor' : formatCurrency(row.unit_price)}`,
          `Toplam maliyet: ${totalCost == null ? 'Maliyet bilinmiyor' : formatCurrency(totalCost)}`,
          `Ayar: ${row.ayar ?? 'Belirtilmedi'}`,
        ]
      }}
      renderExtra={(row) =>
        row.unit_price == null ? (
          <Alert variant="warning" className="mt-3">
            Bu işlem adede dahil; ortalama maliyet ve kâr/zarar hesabına dahil değil.
          </Alert>
        ) : null
      }
      getCardClassName={(row) =>
        row.unit_price == null
          ? 'border-warning/30 bg-warning/5 dark:bg-warning/10'
          : 'border-warning/20 bg-warning/5 dark:bg-warning/8'
      }
      groupBy={(row) => GOLD_TYPE_LABELS[row.gold_type]}
    />
  )
}
