import { ArrowDownRight, ArrowUpRight, Banknote, ChevronDown, ChevronUp, Coins, Landmark, LineChart, Minus, Plus, ShieldCheck, TrendingUp, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ComponentType, type FormEvent } from 'react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { type CompositionSlice } from '../components/charts/CompositionBar'
import { BreakdownBar, HeroNumber, LineGroup, LineRow, SERIT_TEXT, useSeritAmount } from '../components/serit'
import { buildVizColorMap, orderSlicesCanonically } from '../components/charts/vizPalette'
import { RatesBanner } from '../components/finance/RatesBanner'
import { Button } from '../components/ui/button'
import { fetchCrudRows } from '../data/repositories/crudRepo'
import { useMarketRates } from '../hooks/useMarketRates'
import { useStockPrices } from '../hooks/useStockPrices'
import { normalizeTicker, type StockPrices } from '../lib/stockQuotesClient'
import { assetTradeRequiresQuantity, submitAssetTrade, type AssetTradeDirection } from '../services/assetTrades'
import { fetchAssetValueHistory, recordAssetValueChange } from '../services/assetValueHistory'
import type { Asset, Card as FinanceCard } from '../types/database'
import { formatCurrency, formatNumber, formatPercent, parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { GOLD_LEDGER_SOURCE } from '../utils/goldLedger'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, greaterThanTL, sumTL, roundTL } from '../utils/money'
import { assetRateSymbol, effectiveAssetValue, stockCostBasis, stockProfit, valueAsset, valueStock } from '../utils/valuation'
import { AssetTradeModal, type AssetTradeDraft } from './AssetsPage.tradeModal'

const categoryOptions: Asset['category'][] = ['Nakit', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer']
const formCategoryOptions = categoryOptions.filter((category) => category !== 'Altın')

/** Context passed to form fields: live FX rates + live BIST prices. */
type FieldCtx = { snapshot: MarketRatesSnapshot | null; stockPrices: StockPrices }

/* Varlık sınıfı → renk + ikon.
   Renk kimlik taşır, durum değil: eskiden Nakit yeşil (=başarı), Altın amber
   (=uyarı) okunuyordu ve #fb923c/#2dd4bf koyu temaya uyum sağlamıyordu.
   Artık doğrulanmış kimlik slotları; "Diğer" kasıtlı nötr.
   "Banka" sentetik bir dilim ama kimliği var: eskiden var(--info) ile boyanıyordu
   ve slot-1 "Nakit" ile normal görüşte ΔE 9.3 kalıyordu (eşik 15) — yan yana iki
   mavi, üstelik anlamca da bitişik iki kavram. Artık kendi slotu var. */
const ASSET_ORDER = ['Nakit', 'Banka', 'Altın', 'Fon', 'Hisse', 'Araç', 'BES', 'Diğer'] as const
const ASSET_COLORS = buildVizColorMap(ASSET_ORDER, ['Diğer'])

const categoryMeta: Record<Asset['category'], { color: string; icon: ComponentType<{ className?: string }> }> = {
  Nakit: { color: ASSET_COLORS['Nakit'], icon: Banknote },
  Altın: { color: ASSET_COLORS['Altın'], icon: Coins },
  Fon:   { color: ASSET_COLORS['Fon'],   icon: LineChart },
  Hisse: { color: ASSET_COLORS['Hisse'], icon: TrendingUp },
  Araç:  { color: ASSET_COLORS['Araç'],  icon: Wallet },
  BES:   { color: ASSET_COLORS['BES'],   icon: ShieldCheck },
  Diğer: { color: ASSET_COLORS['Diğer'], icon: Landmark },
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

function canTradeAsset(row: Asset): boolean {
  if (row.category === 'Altın' || isGoldLedgerAsset(row)) return false
  if (row.category === 'BES' || row.category === 'Araç') return false
  return true
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
  const { formatAmount } = useBalancePrivacy()
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

function AssetsOverview({ rows, snapshot, stockPrices, bankCash }: { rows: Asset[]; snapshot: MarketRatesSnapshot | null; stockPrices: StockPrices; bankCash: number }) {
  // Gizlilik maskesi (tutarları gizle) bu hook üzerinden geliyor; ham
  // formatSeritAmount kullanılırsa maske atlanır ve tutar sızar.
  const seritAmount = useSeritAmount()
  if (rows.length === 0) return null

  const valueOf = (row: Asset) => effectiveAssetValue(row, snapshot, stockPrices)
  // Toplam, dashboard'daki "Toplam varlık" ile aynı tanımı kullanır (varlık
  // kayıtları + banka bakiyeleri); iki sayfa farklı toplam göstermesin.
  const total = sumTL([...rows.map(valueOf), bankCash])
  const categoryTotals = categoryOptions
    .map((category) => ({
      category,
      total: sumTL(rows.filter((row) => row.category === category).map(valueOf)),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)

  const cashTotal = sumTL([categoryTotals.find((item) => item.category === 'Nakit')?.total ?? 0, bankCash])
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

  // Halka kanonik sırada: renk komşuluğu doğrulanmış kalsın (bkz. vizPalette).
  const donutData: CompositionSlice[] = orderSlicesCanonically(
    [
      ...categoryTotals.map((item) => ({
        name: item.category,
        value: item.total,
        color: categoryMeta[item.category].color,
      })),
      ...(bankCash > 0 ? [{ name: 'Banka', value: bankCash, color: ASSET_COLORS['Banka'] }] : []),
    ],
    ASSET_ORDER,
  )

  // Sınıf satırları: kırılım çubuğuyla AYNI sırayı ve rengi kullanır, yoksa
  // çubuktaki dilimi altındaki satırla eşlemek gözle yapılamaz.
  const classRows = donutData.map((slice) => {
    const isBank = slice.name === 'Banka'
    const categoryRows = isBank ? [] : rows.filter((row) => row.category === slice.name)
    return {
      name: slice.name,
      color: slice.color,
      value: slice.value,
      sharePct: total > 0 ? (slice.value / total) * 100 : 0,
      subtitle: isBank ? 'Banka hesapları' : `${categoryRows.length} kayıt`,
      profitPct: slice.name === 'Hisse' && hasStockCost ? stockProfitPct : null,
    }
  })

  return (
    <section>
      <HeroNumber
        label="Toplam varlık"
        value={total}
        description={
          topCategory ? (
            <>
              En büyük kalem <span className="font-semibold text-ink">{topCategory.category}</span> · nakit ve banka{' '}
              <span className="serit-num font-semibold text-ink">{seritAmount(cashTotal).amount} ₺</span>
            </>
          ) : undefined
        }
      />

      <div className="mt-[18px]">
        <BreakdownBar
          segments={donutData.map((slice) => ({
            label: slice.name,
            value: slice.value,
            tone: 'neutral' as const,
            color: slice.color,
          }))}
          showValues={false}
        />
      </div>

      <div className="mt-5">
        <LineGroup>
          {classRows.map((item) => (
            <LineRow
              key={item.name}
              lead={
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: item.color }}
                />
              }
              title={item.name}
              subtitle={item.subtitle}
              amount={item.value}
              trailing={
                <p
                  className="serit-num mt-0.5 text-[11px]"
                  style={{
                    color:
                      item.profitPct === null
                        ? SERIT_TEXT.neutral
                        : item.profitPct >= 0
                          ? SERIT_TEXT.brand
                          : SERIT_TEXT.danger,
                  }}
                >
                  {item.profitPct === null
                    ? formatPercent(item.sharePct)
                    : formatPercent(item.profitPct, { signed: true })}
                </p>
              }
            />
          ))}
        </LineGroup>
      </div>
    </section>
  )
}

/** Shows recent value-update history for a manual asset (BES, Araç, Diğer, etc.). */
function AssetValueHistoryPanel({
  asset,
  formatAmount: fmt,
}: {
  asset: Asset
  formatAmount: (value: number | null | undefined) => string
}) {
  const [entries, setEntries] = useState<import('../types/database').TransactionHistory[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchAssetValueHistory(asset.id, 5).then((data) => {
      if (!cancelled) setEntries(data)
    })
    return () => { cancelled = true }
  }, [asset.id, asset.updated_at])

  if (!entries || entries.length === 0) return null

  return (
    <div className="mt-3 rounded-lg bg-card/70 p-3 ring-1 ring-border/60">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-[11px] font-black uppercase text-muted-foreground"
      >
        <span>Güncelleme geçmişi ({entries.length})</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {entries.map((entry) => {
            const delta = entry.amount ?? 0
            const isUp = delta >= 0
            return (
              <div key={entry.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/45 px-2.5 py-2 text-xs">
                <span className="min-w-0 truncate text-muted-foreground">
                  {new Date(entry.occurred_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className={isUp ? 'font-black text-success' : 'font-black text-destructive'}>
                    {delta > 0 ? '+' : ''}{fmt(delta)}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function AssetsPage() {
  const { formatAmount } = useBalancePrivacy()
  const { snapshot } = useMarketRates()
  const [stockPrices, setStockPrices] = useState<StockPrices>({})
  const [accounts, setAccounts] = useState<FinanceCard[]>([])
  const [trade, setTrade] = useState<AssetTradeDraft | null>(null)
  const [tradeAccountId, setTradeAccountId] = useState('')
  const [tradeAmount, setTradeAmount] = useState('')
  const [tradeQuantity, setTradeQuantity] = useState('')
  const [tradeNote, setTradeNote] = useState('')
  const [tradeError, setTradeError] = useState('')
  const [tradeSaving, setTradeSaving] = useState(false)
  const fieldContext = useMemo<FieldCtx>(() => ({ snapshot, stockPrices }), [snapshot, stockPrices])
  const bankAccounts = useMemo(
    () => accounts.filter((account) => account.card_type === 'banka_karti'),
    [accounts],
  )

  const loadAccounts = useCallback(async () => {
    const result = await fetchCrudRows('cards', 'created_at', false)
    if (!result.ok) {
      setTradeError(result.error.message ?? 'Banka hesapları yüklenemedi.')
      setAccounts([])
      return
    }
    setAccounts(result.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccounts()
  }, [loadAccounts])

  function openTrade(asset: Asset, direction: AssetTradeDirection) {
    setTrade({ asset, direction })
    setTradeAccountId(bankAccounts[0]?.id ?? '')
    setTradeAmount(direction === 'sell' && greaterThanTL(asset.estimated_value_try, 0) ? String(asset.estimated_value_try) : '')
    setTradeQuantity(direction === 'sell' && assetTradeRequiresQuantity(asset) && asset.amount > 0 ? String(asset.amount) : '')
    setTradeNote('')
    setTradeError('')
    void loadAccounts()
  }

  function closeTrade() {
    if (tradeSaving) return
    setTrade(null)
    setTradeError('')
  }

  async function handleTradeSubmit(
    event: FormEvent<HTMLFormElement>,
    reloadAssets: () => Promise<void>,
    setPageError: (message: string) => void,
  ) {
    event.preventDefault()
    if (!trade) return

    const selectedAccount = bankAccounts.find((account) => account.id === tradeAccountId)
    const amount = parseNumber(tradeAmount)
    const quantity = tradeQuantity.trim() ? parseNumber(tradeQuantity) : null

    if (!selectedAccount) {
      setTradeError(trade.direction === 'buy' ? 'Kaynak hesap seçmelisin.' : 'Tahsilat hesabı seçmelisin.')
      return
    }
    if (!greaterThanTL(amount, 0)) {
      setTradeError('İşlem tutarı 0’dan büyük olmalı.')
      return
    }
    if (trade.direction === 'buy' && greaterThanTL(amount, selectedAccount.current_balance)) {
      setTradeError('Kaynak hesap bakiyesi yetersiz.')
      return
    }
    if (trade.direction === 'sell' && greaterThanTL(amount, trade.asset.estimated_value_try)) {
      setTradeError('Satış tutarı varlığın kayıtlı değerinden büyük olamaz.')
      return
    }
    if (assetTradeRequiresQuantity(trade.asset) && (!quantity || quantity <= 0)) {
      setTradeError('Hisse, fon ve döviz işlemlerinde miktar girilmeli.')
      return
    }
    if (trade.direction === 'sell' && quantity !== null && quantity > trade.asset.amount) {
      setTradeError('Satış miktarı mevcut miktardan büyük olamaz.')
      return
    }

    setTradeSaving(true)
    setTradeError('')
    const result = await submitAssetTrade({
      assetId: trade.asset.id,
      accountId: selectedAccount.id,
      direction: trade.direction,
      amount,
      quantity,
      note: tradeNote.trim() || null,
    })

    if (result.error) {
      setTradeError(result.error.message ?? 'Varlık işlemi tamamlanamadı.')
      setTradeSaving(false)
      return
    }

    setTrade(null)
    setTradeSaving(false)
    try {
      await Promise.all([reloadAssets(), loadAccounts()])
    } catch (reloadError) {
      setPageError(reloadError instanceof Error ? reloadError.message : 'İşlem tamamlandı ama liste yenilenemedi.')
    }
  }

  return (
    <CrudPage
        table="assets"
        pageTitle="Varlıklar"
        pageLabel="Servet merkezi"
        pageDescription="Nakit, yatırım ve fiziksel varlıklarının güncel değerini tek portföy görünümünde yönet."
        addLabel="Varlık ekle"
        fields={fields}
        fieldContext={fieldContext}
        validateForm={validateAssetForm}
        afterSave={async (savedRow, action, { previousRow }) => {
          if (action !== 'update' || !previousRow) return
          const prev = previousRow as Asset
          const next = savedRow as Asset
          // Only record history for manual-valued assets when value actually changed
          if (!next.auto_valued && prev.estimated_value_try !== next.estimated_value_try) {
            await recordAssetValueChange(next, prev.estimated_value_try, next.estimated_value_try)
          }
        }}
        emptyTitle="Henüz varlık yok"
        emptyDescription="Nakit, fon, hisse veya diğer varlıklarını buradan ekleyebilirsin. Altın işlemleri ayrı Altın sekmesinde tutulur."
        renderBeforeList={({ loading, rows, reload, setError }) => (
          <div className="space-y-3">
            <AssetTradeModal
              trade={trade}
              accounts={bankAccounts}
              accountId={tradeAccountId}
              amount={tradeAmount}
              quantity={tradeQuantity}
              note={tradeNote}
              error={tradeError}
              saving={tradeSaving}
              onClose={closeTrade}
              onAccountChange={setTradeAccountId}
              onAmountChange={setTradeAmount}
              onQuantityChange={setTradeQuantity}
              onNoteChange={setTradeNote}
              onSubmit={(event) => void handleTradeSubmit(event, reload, setError)}
            />
            <StockPriceSync rows={rows as Asset[]} onPrices={setStockPrices} />
            <RatesBanner
              onSynced={reload}
              note={
                (rows as Asset[]).some((row) => row.category === 'Hisse' && row.symbol)
                  ? 'BIST fiyatları Yahoo Finance üzerinden ~15 dk gecikmelidir.'
                  : undefined
              }
            />
            {!loading ? (
              <AssetsOverview
                rows={rows as Asset[]}
                snapshot={snapshot}
                stockPrices={stockPrices}
                bankCash={sumTL(accounts.filter((account) => account.card_type === 'banka_karti').map((account) => account.current_balance))}
              />
            ) : null}
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
        renderRowActions={(row) => {
          const asset = row as Asset
          if (!canTradeAsset(asset)) return null
          return (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => openTrade(asset, 'buy')}>
                <Plus />
                Al
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openTrade(asset, 'sell')}
                disabled={!greaterThanTL(asset.estimated_value_try, 0)}
              >
                <Minus />
                Sat
              </Button>
            </>
          )
        }}
        canEditRow={(row) => row.category !== 'Altın'}
        canDeleteRow={(row) => !isGoldLedgerAsset(row)}
        renderCard={(row, { menu, rowActions }) => {
          const asset = row as Asset
          const value = effectiveAssetValue(asset, snapshot, stockPrices)
          const meta = categoryMeta[asset.category]
          const Icon = meta.icon
          const pl = asset.category === 'Hisse' ? stockProfit(value, asset) : null

          return (
            <article className={`rounded-2xl border p-4 transition-all duration-250 hover:-translate-y-0.5 min-[390px]:p-5 ${categoryCardTint[asset.category]}`}>
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

              {rowActions}

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

              {!asset.auto_valued && !isGoldLedgerAsset(asset) ? (
                <AssetValueHistoryPanel asset={asset} formatAmount={formatAmount} />
              ) : null}
            </article>
          )
        }}
        groupBy={(row) => row.category}
      />
  )
}
