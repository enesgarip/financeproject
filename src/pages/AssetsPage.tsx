import { ArrowDownRight, ArrowUpRight, Banknote, Coins, Landmark, LineChart, ShieldCheck, TrendingUp, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart'
import { RatesBanner } from '../components/finance/RatesBanner'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { useMarketRates } from '../hooks/useMarketRates'
import { useStockPrices } from '../hooks/useStockPrices'
import { normalizeTicker, type StockPrices } from '../lib/stockQuotesClient'
import type { Asset } from '../types/database'
import { formatCurrency, formatNumber, parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { GOLD_LEDGER_SOURCE } from '../utils/goldLedger'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, sumTL, roundTL } from '../utils/money'
import { assetRateSymbol, effectiveAssetValue, stockCostBasis, stockProfit, valueAsset, valueStock } from '../utils/valuation'

const categoryOptions: Asset['category'][] = ['Nakit', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer']
const formCategoryOptions = categoryOptions.filter((category) => category !== 'Altın')

/** Context passed to form fields: live FX rates + live BIST prices. */
type FieldCtx = { snapshot: MarketRatesSnapshot | null; stockPrices: StockPrices }

/* Category → colour + icon mapping driven by design tokens */
const categoryMeta: Record<Asset['category'], { color: string; icon: ComponentType<{ className?: string }> }> = {
  Nakit: { color: 'var(--success)',     icon: Banknote },
  Altın: { color: 'var(--warning)',     icon: Coins },
  Fon:   { color: 'var(--info)',        icon: LineChart },
  Hisse: { color: 'var(--primary)',     icon: TrendingUp },
  Araç:  { color: '#fb923c',            icon: Wallet },
  BES:   { color: '#2dd4bf',            icon: ShieldCheck },
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

function isGoldLedgerAsset(row: Asset): boolean {
  return row.source === GOLD_LEDGER_SOURCE
}

/** A row is auto-valuable when its category maps to a market symbol or BIST ticker. */
function assetSupportsAuto(values: Record<string, string>): boolean {
  if (values.category === 'Altın') return true
  if (values.category === 'Hisse') return Boolean(values.symbol?.trim())
  return values.category === 'Nakit' && Boolean(values.currency) && values.currency !== 'TRY'
}

function assetIsAuto(values: Record<string, string>): boolean {
  return assetSupportsAuto(values) && values.valuation === 'auto'
}

/** Build the valuation-helper shape the pure functions expect from raw form values. */
function valuationInputFromForm(values: Record<string, string>): Pick<Asset, 'category' | 'unit' | 'currency' | 'amount' | 'symbol' | 'unit_cost'> {
  const category = (values.category as Asset['category']) ?? 'Nakit'
  const isGold = category === 'Altın'
  return {
    category,
    unit: isGold ? ((values.unit as Asset['unit']) || 'gram') : 'TRY',
    currency: category === 'Nakit' ? ((values.currency as Asset['currency']) || 'TRY') : null,
    amount: parseNumber(values.amount),
    symbol: category === 'Hisse' ? (normalizeTicker(values.symbol) ?? null) : null,
    unit_cost: category === 'Hisse' ? parseNumber(values.unit_cost) : null,
  }
}

function assetRateHint(values: Record<string, string>, context: unknown): string | null {
  const snapshot = (context as FieldCtx | null)?.snapshot ?? null
  if (!snapshot) return null
  const input = valuationInputFromForm(values)
  const symbol = assetRateSymbol(input)
  const rate = symbol ? snapshot.rates[symbol] : undefined
  if (!rate) return null
  const unitLabel = input.category === 'Altın' ? (input.unit === 'gram' ? 'gram' : 'çeyrek') : input.currency
  return `1 ${unitLabel} ≈ ${formatCurrency(rate.buying)} (canlı)`
}

function assetStockHint(values: Record<string, string>, context: unknown): string | null {
  const ticker = normalizeTicker(values.symbol)
  if (!ticker) return null
  const price = (context as FieldCtx | null)?.stockPrices?.[ticker]
  if (!price) return 'Kaydedince canlı fiyatla değerlenecek (BIST).'
  return `1 ${ticker} ≈ ${formatCurrency(price)} (canlı)`
}

const fields: FormField[] = [
  { name: 'name', label: 'Ad', type: 'text', required: true },
  {
    name: 'category',
    label: 'Kategori',
    type: 'select',
    options: formCategoryOptions.map((value) => ({ label: value, value })),
  },
  {
    name: 'symbol',
    label: 'BIST sembolü (örn. THYAO)',
    type: 'text',
    required: true,
    visibleWhen: { field: 'category', value: 'Hisse' },
    hint: assetStockHint,
  },
  {
    name: 'amount',
    label: 'Adet',
    type: 'number',
    min: '0',
    step: '1',
    required: true,
    visibleWhen: { field: 'category', value: 'Hisse' },
  },
  {
    name: 'unit_cost',
    label: 'Birim maliyet (₺/adet)',
    type: 'number',
    min: '0',
    step: '0.01',
    visibleWhen: { field: 'category', value: 'Hisse' },
    hint: () => 'Ortalama alış maliyetin — kâr/zarar bundan hesaplanır.',
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
    name: 'valuation',
    label: 'Değerleme',
    type: 'select',
    options: [
      { label: 'Otomatik (canlı fiyat)', value: 'auto' },
      { label: 'Manuel', value: 'manual' },
    ],
    visibleWhen: (values) => assetSupportsAuto(values),
  },
  {
    name: 'amount',
    label: 'Altın miktarı',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: { field: 'category', value: 'Altın' },
    hint: assetRateHint,
  },
  {
    name: 'unit',
    label: 'Altın birimi',
    type: 'select',
    options: [
      { label: 'Gram', value: 'gram' },
      { label: 'Çeyrek (adet)', value: 'adet' },
    ],
    visibleWhen: { field: 'category', value: 'Altın' },
  },
  {
    name: 'amount',
    label: 'Döviz tutarı',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: (values) => values.category === 'Nakit' && Boolean(values.currency) && values.currency !== 'TRY',
    hint: assetRateHint,
  },
  {
    name: 'estimated_value_try',
    label: 'Toplam değer (TRY)',
    type: 'number',
    min: '0',
    step: '0.01',
    required: true,
    visibleWhen: (values) => !assetIsAuto(values),
  },
  {
    name: 'estimated_value_try_preview',
    label: 'Güncel değer (otomatik)',
    type: 'computed',
    visibleWhen: (values) => assetIsAuto(values),
    compute: (values, context) => {
      const ctx = context as FieldCtx | null
      const input = valuationInputFromForm(values)
      return input.category === 'Hisse'
        ? valueStock(input, ctx?.stockPrices)
        : valueAsset(input, ctx?.snapshot)
    },
    formatComputed: (value) => (value === null ? 'Fiyat bekleniyor…' : formatCurrency(value)),
  },
  { name: 'note', label: 'Not', type: 'textarea' },
]

/** Side-effect-only child: keeps the parent's live BIST price map in sync with the loaded rows. */
function StockPriceSync({ rows, onPrices }: { rows: Asset[]; onPrices: (prices: StockPrices) => void }) {
  const symbols = rows.filter((row) => row.category === 'Hisse').map((row) => row.symbol)
  const prices = useStockPrices(symbols)
  useEffect(() => {
    onPrices(prices)
  }, [prices, onPrices])
  return null
}

function ProfitBadge({ profit, profitPct }: { profit: number; profitPct: number }) {
  const up = profit >= 0
  return (
    <div className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${up ? 'border-success/20 bg-success/8 text-success' : 'border-destructive/20 bg-destructive/8 text-destructive'}`}>
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      <span className="font-mono font-semibold tabular-nums">
        {profit >= 0 ? '+' : ''}{formatAmount(profit)} ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(1)}%)
      </span>
    </div>
  )
}

function validateAssetForm(formData: FormData): Record<string, string> {
  const category = formData.get('category')
  if (category === 'Altın') return { category: 'Altın varlıkları artık Altın sekmesinden işlem olarak eklenir.' }
  return {}
}

function AssetsOverview({ rows, snapshot, stockPrices }: { rows: Asset[]; snapshot: MarketRatesSnapshot | null; stockPrices: StockPrices }) {
  if (rows.length === 0) return null

  const valueOf = (row: Asset) => effectiveAssetValue(row, snapshot, stockPrices)
  const total = sumTL(rows.map(valueOf))
  const categoryTotals = categoryOptions
    .map((category) => ({
      category,
      total: sumTL(rows.filter((row) => row.category === category).map(valueOf)),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)

  const cashTotal = categoryTotals.find((item) => item.category === 'Nakit')?.total ?? 0
  const topCategory = categoryTotals[0]

  // Aggregate stock profit/loss across all priced holdings with a cost basis.
  const stockRows = rows.filter((row) => row.category === 'Hisse')
  const stockCosts: number[] = []
  const stockValues: number[] = []
  let hasStockCost = false
  for (const row of stockRows) {
    const cost = stockCostBasis(row)
    if (cost === null) continue
    hasStockCost = true
    stockCosts.push(cost)
    stockValues.push(valueOf(row))
  }
  const stockCost = sumTL(stockCosts)
  const stockValue = sumTL(stockValues)
  const stockProfitTotal = diffTL(stockValue, stockCost)
  const stockProfitPct = stockCost > 0 ? (stockProfitTotal / stockCost) * 100 : 0

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
                  {formatAmount(total)}
                </p>
              </div>
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
                <Wallet className="size-5" />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="finance-label truncate">Nakit</p>
                <p className="finance-value mt-1 truncate text-sm font-bold text-success">{formatAmount(cashTotal)}</p>
              </div>
              <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="finance-label truncate">En Büyük Kalem</p>
                <p className="finance-value mt-1 truncate text-sm font-bold text-foreground">
                  {topCategory ? topCategory.category : '—'}
                </p>
              </div>
            </div>

            {hasStockCost ? (
              <div className="mt-2 min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                <p className="finance-label truncate">Hisse Kâr / Zarar</p>
                <p className={`finance-value mt-1 truncate text-sm font-bold tabular-nums ${stockProfitTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {stockProfitTotal >= 0 ? '+' : ''}{formatAmount(stockProfitTotal)} ({stockProfitPct >= 0 ? '+' : ''}{stockProfitPct.toFixed(1)}%)
                </p>
              </div>
            ) : null}

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

export function AssetsPage() {
  const { formatAmount } = useBalancePrivacy()
  const { snapshot } = useMarketRates()
  const [stockPrices, setStockPrices] = useState<StockPrices>({})
  const fieldContext = useMemo<FieldCtx>(() => ({ snapshot, stockPrices }), [snapshot, stockPrices])

  return (
    <CrudPage
        table="assets"
        pageTitle="Varlıklar"
        addLabel="Varlık ekle"
        fields={fields}
        fieldContext={fieldContext}
        validateForm={validateAssetForm}
        emptyTitle="Henüz varlık yok"
        emptyDescription="Nakit, fon, hisse veya diğer varlıklarını buradan ekleyebilirsin. Altın işlemleri ayrı Altın sekmesinde tutulur."
        renderBeforeList={({ loading, rows, reload }) => (
          <div className="space-y-3">
            <StockPriceSync rows={rows as Asset[]} onPrices={setStockPrices} />
            <RatesBanner
              onSynced={reload}
              note={
                (rows as Asset[]).some((row) => row.category === 'Hisse' && row.symbol)
                  ? 'BIST fiyatları Yahoo Finance üzerinden ~15 dk gecikmelidir.'
                  : undefined
              }
            />
            {!loading ? <AssetsOverview rows={rows as Asset[]} snapshot={snapshot} stockPrices={stockPrices} /> : null}
          </div>
        )}
        getInitialValues={(row?: Asset) => ({
          name: row?.name ?? '',
          category: row?.category ?? 'Nakit',
          amount: row?.amount ?? 0,
          unit: row?.unit === 'TRY' ? 'gram' : (row?.unit ?? 'gram'),
          currency: row?.currency ?? 'TRY',
          symbol: row?.symbol ?? '',
          unit_cost: row?.unit_cost ?? 0,
          valuation: row ? (row.auto_valued ? 'auto' : 'manual') : 'auto',
          estimated_value_try: row?.estimated_value_try ?? 0,
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId, _editing, context) => {
          const ctx = context as FieldCtx | null
          const category = formData.get('category') as Asset['category']
          const isGold = category === 'Altın'
          const isStock = category === 'Hisse'
          const currency = category === 'Nakit' ? (formData.get('currency') as Asset['currency']) : null
          const foreignCash = category === 'Nakit' && currency !== null && currency !== 'TRY'
          const symbol = isStock ? normalizeTicker(formData.get('symbol') as string) : null
          const unitCost = isStock ? parseNumber(formData.get('unit_cost')) : null
          const supportsAuto = isGold || foreignCash || (isStock && Boolean(symbol))
          const autoValued = supportsAuto && formData.get('valuation') === 'auto'
          const amount = isGold || foreignCash || isStock ? parseNumber(formData.get('amount')) : 1
          const unit: Asset['unit'] = isGold ? (formData.get('unit') as Asset['unit']) : 'TRY'

          const manualValue = parseNumber(formData.get('estimated_value_try'))
          const autoValue = autoValued
            ? isStock
              ? valueStock({ category, symbol, amount }, ctx?.stockPrices)
              : valueAsset({ category, unit, currency, amount }, ctx?.snapshot)
            : null
          // New stock with no live price yet → seed with cost basis; the sync corrects it.
          const stockSeed = isStock && unitCost ? roundTL(unitCost * amount) : null

          return {
            user_id: userId,
            name: String(formData.get('name') ?? ''),
            category,
            amount,
            unit,
            currency: category === 'Nakit' ? (currency ?? 'TRY') : null,
            symbol,
            unit_cost: unitCost,
            estimated_value_try: autoValue ?? (autoValued ? stockSeed ?? manualValue : manualValue),
            auto_valued: autoValued,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.name}
        renderSubtitle={(row) => {
          if (isGoldLedgerAsset(row)) return `${row.category} · defter`
          return row.category === 'Hisse' && row.symbol ? `${row.category} · ${row.symbol}` : row.category
        }}
        renderDetails={(row) => [`Değer: ${formatAmount(effectiveAssetValue(row, snapshot, stockPrices))}`]}
        canEditRow={(row) => row.category !== 'Altın'}
        canDeleteRow={(row) => !isGoldLedgerAsset(row)}
        renderCard={(row, { menu }) => {
          const asset = row as Asset
          const value = effectiveAssetValue(asset, snapshot, stockPrices)
          const meta = categoryMeta[asset.category]
          const Icon = meta.icon
          const pl = asset.category === 'Hisse' ? stockProfit(value, asset) : null

          return (
            <article className={`rounded-2xl border p-4 shadow-[var(--shadow-card)] transition-all duration-250 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)] dark:ring-1 dark:ring-white/[0.04] min-[390px]:p-5 ${categoryCardTint[asset.category]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 15%, transparent)`, color: meta.color }}>
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-black text-foreground">{asset.name}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {isGoldLedgerAsset(asset) ? `${asset.category} · defter` : asset.category === 'Hisse' && asset.symbol ? `${asset.category} · ${asset.symbol}` : asset.category}
                    </p>
                  </div>
                </div>
                {menu}
              </div>

              <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Değer</p>
                  <p className="mt-0.5 font-mono text-lg font-black tabular-nums text-foreground">{formatAmount(value)}</p>
                </div>
                {(asset.category === 'Altın' || asset.category === 'Hisse') && asset.amount > 0 ? (
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {asset.category === 'Altın' ? 'Miktar' : 'Adet'}
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
                      {formatNumber(asset.amount)} {asset.category === 'Altın' ? (asset.unit === 'adet' ? 'çeyrek' : asset.unit) : 'adet'}
                    </p>
                  </div>
                ) : null}
                {asset.category === 'Nakit' && asset.currency && asset.currency !== 'TRY' ? (
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Tutar</p>
                    <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">{formatNumber(asset.amount)} {asset.currency}</p>
                  </div>
                ) : null}
              </div>

              {asset.auto_valued ? (
                <p className="mt-2.5 text-[11px] font-semibold text-muted-foreground/70">Canlı fiyatla otomatik</p>
              ) : null}

              {pl ? <ProfitBadge profit={pl.profit} profitPct={pl.profitPct} /> : null}
            </article>
          )
        }}
        groupBy={(row) => row.category}
      />
  )
}
