import { TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useCrudRows } from '../app/useCrudRows'
import { CrudPage, type FormField } from '../components/CrudPage'
import { RatesBanner } from '../components/finance/RatesBanner'
import { Delta, HeroNumber, LineGroup, LineRow, SERIT_TEXT } from '../components/serit'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { useStockPrices } from '../hooks/useStockPrices'
import { fetchStockHistory, normalizeTicker, type StockHistory, type StockPrices } from '../lib/stockQuotesClient'
import type { Asset, StockTrade, StockTradeKind } from '../types/database'
import { dateInputValue, formatDate } from '../utils/date'
import { formatCurrency, formatNumber, formatPercent, parseNumber } from '../utils/formatCurrency'
import { sumTL } from '../utils/money'
import {
  annotateRealized,
  closeOnOrBefore,
  historyRangeFor,
  projectStockPositions,
  stockLedgerDrift,
  stockPeriodPerformance,
  valueStockPosition,
} from '../utils/stockLedger'

/**
 * Borsa: hisse işlem defteri + portföy performansı (Altın sayfasının ikizi).
 *
 * Pozisyonun kanonik kaynağı Varlıklar'daki Hisse satırı (hedef kaynağı, net
 * değer, canlı senkron onu okur); defter TARİHÇEDİR. Ortalama maliyet,
 * gerçekleşmiş/gerçekleşmemiş K/Z ve dönem getirisi `utils/stockLedger`'da
 * saf hesaplanır; bu sayfa yalnız veri toplar ve gösterir.
 *
 * Dönem başı değeri için tarihsel kapanış `bist-quote` + `range` ile gelir
 * (`fetchStockHistory`); fiyatı olmayan sembol sonuçtan düşülmez, uyarı olur.
 *
 * Elle girilen işlem YALNIZ defteri besler (nakit/varlık değişmez) — geçmişi
 * geri doldurmak için. Bugünkü al/sat Varlıklar'daki Al/Sat'tan yapılır; RPC
 * defter satırını kendisi yazar.
 */

const KIND_LABELS: Record<StockTradeKind, string> = { buy: 'Alış', sell: 'Satış', opening: 'Açılış' }

const tradeFields: FormField[] = [
  { name: 'symbol', label: 'BIST sembolü (örn. THYAO)', type: 'text', required: true },
  {
    name: 'kind',
    label: 'İşlem türü',
    type: 'select',
    options: [
      { label: 'Alış', value: 'buy' },
      { label: 'Satış', value: 'sell' },
      { label: 'Açılış pozisyonu (geçmişi bilinmeyen)', value: 'opening' },
    ],
  },
  { name: 'trade_date', label: 'Tarih', type: 'date', required: true },
  { name: 'quantity', label: 'Adet', type: 'number', min: '0.0001', step: '0.0001', required: true },
  {
    name: 'unit_price',
    label: 'Birim fiyat (₺/adet)',
    type: 'number',
    min: '0',
    step: '0.0001',
    hint: (values) => (values.kind === 'opening' ? 'Boş bırakırsan adet sayılır, maliyet tabanına girmez.' : 'Alışta ödenen, satışta alınan birim fiyat.'),
  },
  { name: 'fee', label: 'Komisyon (₺)', type: 'number', min: '0', step: '0.01', hint: () => 'Alışta maliyete eklenir, satışta hasılattan düşer.' },
  { name: 'note', label: 'Not', type: 'textarea' },
]

type PeriodKey = 'all' | '1m' | '3m' | 'ytd' | '1y' | 'custom'
const PERIOD_LABELS: Record<PeriodKey, string> = { all: 'Baştan beri', '1m': '1 ay', '3m': '3 ay', ytd: 'Bu yıl', '1y': '1 yıl', custom: 'Özel' }

function shiftMonths(date: Date, months: number): string {
  const d = new Date(date)
  d.setMonth(d.getMonth() - months)
  return dateInputValue(d)
}

function periodStart(key: PeriodKey, custom: string, now: Date): string | null {
  if (key === 'all') return null
  if (key === 'custom') return custom || null
  if (key === 'ytd') return `${now.getFullYear() - 1}-12-31`
  return shiftMonths(now, key === '1m' ? 1 : key === '3m' ? 3 : 12)
}

function optionalNumber(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim()
  return raw ? parseNumber(raw) : null
}

function validateTrade(formData: FormData, rows: StockTrade[], editing: StockTrade | null): Record<string, string> {
  const errors: Record<string, string> = {}
  const symbol = normalizeTicker(String(formData.get('symbol') ?? ''))
  if (!symbol) errors.symbol = 'Sembol 1-10 harf/rakam olmalı (örn. THYAO).'
  const quantity = parseNumber(formData.get('quantity'))
  if (quantity <= 0) errors.quantity = 'Adet 0’dan büyük olmalı.'
  const kind = formData.get('kind')
  if (kind === 'sell') {
    const price = String(formData.get('unit_price') ?? '').trim()
    if (!price) errors.unit_price = 'Satışta birim fiyat gerekli (gerçekleşen kâr bundan hesaplanır).'
    if (symbol && quantity > 0) {
      const others = editing ? rows.filter((row) => row.id !== editing.id) : rows
      const held = projectStockPositions(others).get(symbol)?.quantity ?? 0
      if (quantity > held) errors.quantity = `${symbol} olarak defterde ${formatNumber(held)} adet var; bundan fazlasını satamazsın.`
    }
  }
  return errors
}

/** Baştan beri + dönem özeti; fiyat/tarihçe toplayıp saf util'e sorar. */
function BorsaOverview({
  trades,
  assets,
  prices,
}: {
  trades: StockTrade[]
  assets: Asset[]
  prices: StockPrices
}) {
  const { formatAmount } = useBalancePrivacy()
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [customStart, setCustomStart] = useState(() => shiftMonths(new Date(), 6))
  const [history, setHistory] = useState<{ range: string; data: StockHistory }>({ range: '', data: {} })

  const today = dateInputValue(new Date())
  const start = periodStart(period, customStart, new Date())
  const symbols = useMemo(() => Array.from(new Set(trades.map((row) => row.symbol))).sort(), [trades])
  const symbolsKey = symbols.join(',')
  const range = start ? historyRangeFor(start) : null
  const historyKey = range ? `${range}:${symbolsKey}` : ''

  useEffect(() => {
    if (!historyKey || !range) return
    let active = true
    void fetchStockHistory(symbols, range).then((data) => {
      if (active) setHistory({ range: historyKey, data })
    })
    return () => {
      active = false
    }
    // symbols dizisi her render'da yeni; anahtar semboller + pencereyi kapsar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey])

  const positions = useMemo(() => projectStockPositions(trades), [trades])
  const valuations = useMemo(
    () => symbols.map((symbol) => valueStockPosition(positions.get(symbol)!, prices[symbol])).filter((v) => v.position.quantity > 0 || v.position.realized !== 0),
    [positions, prices, symbols],
  )
  const drift = useMemo(() => stockLedgerDrift(positions, assets.filter((a) => a.category === 'Hisse')), [positions, assets])

  const pricesAtStart: Record<string, number | null> = {}
  if (start && history.range === historyKey) {
    for (const symbol of symbols) pricesAtStart[symbol] = closeOnOrBefore(history.data[symbol], start)
  }
  const perf = stockPeriodPerformance(trades, { start, end: today, pricesAtStart, pricesAtEnd: prices })
  const historyPending = Boolean(start) && history.range !== historyKey

  const portfolioValue = valuations.every((v) => v.value !== null || v.position.quantity === 0)
    ? sumTL(valuations.map((v) => v.value ?? 0))
    : null
  const totalCost = sumTL(valuations.map((v) => v.position.costBasis))
  const totalRealized = sumTL(valuations.map((v) => v.position.realized))
  const totalUnrealized = valuations.every((v) => v.unrealized !== null || v.position.quantity === 0)
    ? sumTL(valuations.map((v) => v.unrealized ?? 0))
    : null
  const sinceInception = stockPeriodPerformance(trades, { start: null, end: today, pricesAtStart: {}, pricesAtEnd: prices })

  if (trades.length === 0) return null

  return (
    <section className="space-y-5">
      {portfolioValue === null ? (
        <div>
          <p className="uppercase text-ink-faint" style={{ fontSize: 12, letterSpacing: '0.1em', lineHeight: '16px' }}>Portföy değeri</p>
          <p className="mt-2 text-[22px] font-semibold leading-tight text-ink lg:text-[26px]">Fiyat bekleniyor</p>
          <p className="mt-1.5 text-[13px] text-ink-muted">{symbols.length} sembol · canlı BIST fiyatı gelince değer hesaplanacak.</p>
        </div>
      ) : (
        <HeroNumber label="Portföy değeri" value={portfolioValue} description={`${symbols.length} sembol · ${trades.length} işlem · canlı BIST fiyatıyla`} />
      )}

      {sinceInception.missingEndPrices.length === 0 ? (
        <Delta value={sinceInception.gain} percent={sinceInception.gainPct ?? undefined} suffix="baştan beri (gerçekleşmiş + gerçekleşmemiş)" />
      ) : null}

      <LineGroup>
        <LineRow title="Maliyet (elde kalan)" subtitle="ortalama alış × adet, komisyon dahil" amount={totalCost} />
        <LineRow title="Gerçekleşmiş K/Z" subtitle="satışlardan" amount={totalRealized} />
        {totalUnrealized === null ? null : <LineRow title="Gerçekleşmemiş K/Z" subtitle="canlı fiyata göre" amount={totalUnrealized} />}
      </LineGroup>

      {drift.length > 0 ? (
        <p className="rounded-lg bg-warning/8 px-3 py-2 text-[12.5px] ring-1 ring-warning/20" style={{ color: SERIT_TEXT.warning }}>
          Defter ile Varlıklar satırı uyuşmuyor:{' '}
          {drift.map((d) => `${d.symbol} defterde ${formatNumber(d.ledger)}, varlıkta ${formatNumber(d.asset)} adet`).join(' · ')}.
          Geçmiş işlemleri girdiysen açılış satırını sil; Varlıklar satırı bugünkü pozisyonu taşır ve elle düzeltilir.
        </p>
      ) : null}

      <div className="rounded-lg bg-raised p-3 ring-1 ring-line-strong">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-black uppercase text-ink-muted">Dönem performansı</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dönem">
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                aria-pressed={period === key}
                className={`rounded-md px-2 py-1 text-[11px] font-bold ${period === key ? 'bg-ink text-page' : 'bg-page text-ink-muted hover:text-ink'}`}
              >
                {PERIOD_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
        {period === 'custom' ? (
          <label className="mt-2 block text-xs font-semibold text-ink-muted">
            Başlangıç tarihi
            <Input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="mt-1 max-w-xs" aria-label="Dönem başlangıcı" />
          </label>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          {start ? (
            <div>
              <p className="text-ink-muted">Dönem başı ({formatDate(start)})</p>
              <p className="font-black tabular-nums text-ink">{historyPending ? '…' : formatAmount(perf.startValue)}</p>
            </div>
          ) : null}
          <div>
            <p className="text-ink-muted">Alımlar</p>
            <p className="font-black tabular-nums text-ink">{formatAmount(perf.buys)}</p>
          </div>
          <div>
            <p className="text-ink-muted">Satışlar</p>
            <p className="font-black tabular-nums text-ink">{formatAmount(perf.sells)}</p>
          </div>
          <div>
            <p className="text-ink-muted">Bugünkü değer</p>
            <p className="font-black tabular-nums text-ink">{formatAmount(perf.endValue)}</p>
          </div>
          <div>
            <p className="text-ink-muted">Gerçekleşmiş (dönemde)</p>
            <p className="font-black tabular-nums text-ink">{formatAmount(perf.realized)}</p>
          </div>
          <div>
            <p className="text-ink-muted">Kazanç</p>
            <p className={`font-black tabular-nums ${perf.gain > 0 ? 'text-success' : perf.gain < 0 ? 'text-destructive' : 'text-ink'}`}>
              {historyPending ? '…' : (
                <>
                  {perf.gain > 0 ? '+' : ''}
                  {formatAmount(perf.gain)}
                  {perf.gainPct === null ? '' : ` (${formatPercent(perf.gainPct, { signed: true })})`}
                </>
              )}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Kazanç = bugünkü değer − dönem başı değer − alımlar + satışlar; yüzde tabanı dönem başı + alımlar. Dönemdeki alım kazanç sayılmaz.
        </p>
        {!historyPending && (perf.missingStartPrices.length > 0 || perf.missingEndPrices.length > 0) ? (
          <p className="mt-1 text-[12px] font-semibold" style={{ color: SERIT_TEXT.warning }}>
            Fiyatı bulunamayan sembol: {[...new Set([...perf.missingStartPrices, ...perf.missingEndPrices])].join(', ')} — sonuç eksik.
          </p>
        ) : null}
      </div>

      <LineGroup>
        {valuations.map(({ position, price, value, unrealized, unrealizedPct }) => (
          <LineRow
            key={position.symbol}
            title={position.symbol}
            subtitle={[
              `${formatNumber(position.quantity)} adet`,
              position.avgCost === null ? 'maliyet kayıtsız' : `ort. ${formatCurrency(position.avgCost)}`,
              price === null ? 'fiyat yok' : `güncel ${formatCurrency(price)}`,
              position.realized !== 0 ? `gerçekleşmiş ${position.realized > 0 ? '+' : ''}${formatAmount(position.realized)}` : null,
            ].filter(Boolean).join(' · ')}
            amount={value ?? undefined}
            trailing={
              unrealized === null ? null : (
                <p className="serit-num text-[11px]" style={{ color: unrealized >= 0 ? SERIT_TEXT.brand : SERIT_TEXT.danger }}>
                  {unrealized > 0 ? '+' : ''}{formatAmount(unrealized)}{unrealizedPct === null ? '' : ` (${formatPercent(unrealizedPct, { signed: true })})`}
                </p>
              )
            }
          />
        ))}
      </LineGroup>
    </section>
  )
}

function TradeCard({ trade, realized, menu }: { trade: StockTrade; realized: number | null; menu: ReactNode }) {
  const { formatAmount } = useBalancePrivacy()
  const total = trade.unit_price == null ? null : trade.quantity * trade.unit_price + (trade.kind === 'sell' ? -trade.fee : trade.fee)
  return (
    <article className="rounded-2xl border border-line-strong p-4 transition-all duration-250 hover:-translate-y-0.5 min-[390px]:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <TrendingUp className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-black text-ink">{trade.symbol}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span>{formatDate(trade.trade_date)}</span>
              <Badge variant={trade.kind === 'sell' ? 'destructive' : trade.kind === 'opening' ? 'warning' : 'secondary'}>{KIND_LABELS[trade.kind]}</Badge>
              {trade.source === 'trade_rpc' ? <Badge variant="secondary">Al/Sat</Badge> : null}
            </div>
          </div>
        </div>
        {menu}
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 text-sm">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Adet × fiyat</p>
          <p className="mt-0.5 font-mono font-bold tabular-nums text-ink">
            {formatNumber(trade.quantity)} × {trade.unit_price == null ? '—' : formatCurrency(trade.unit_price)}
            {trade.fee > 0 ? <span className="text-ink-muted"> · komisyon {formatCurrency(trade.fee)}</span> : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{trade.kind === 'sell' ? 'Hasılat' : 'Maliyet'}</p>
          <p className="mt-0.5 font-mono text-lg font-black tabular-nums text-ink">{total === null ? 'kayıtsız' : formatAmount(total)}</p>
        </div>
      </div>
      {trade.kind === 'sell' && realized !== null ? (
        <p className={`mt-2 text-xs font-bold ${realized >= 0 ? 'text-success' : 'text-destructive'}`}>
          Gerçekleşmiş K/Z: {realized > 0 ? '+' : ''}{formatAmount(realized)}
        </p>
      ) : null}
      {trade.note ? <p className="mt-2 text-xs italic text-ink-muted">{trade.note}</p> : null}
    </article>
  )
}

export function BorsaPage() {
  const assetsQuery = useCrudRows('assets', 'created_at', false)
  const assets: Asset[] = useMemo(() => (assetsQuery.data ?? []) as Asset[], [assetsQuery.data])
  const stockAssets = useMemo(() => assets.filter((asset) => asset.category === 'Hisse'), [assets])

  return (
    <CrudPage
      table="stock_trades"
      pageTitle="Borsa"
      pageLabel="Yatırım"
      pageDescription="Hisse alım-satım defteri; ortalama maliyet, gerçekleşmiş ve gerçekleşmemiş kâr/zarar, seçtiğin dönemin getirisi."
      addLabel="Geçmiş işlem ekle"
      fields={tradeFields}
      orderBy="trade_date"
      orderAscending={false}
      emptyTitle="Henüz hisse işlemi yok"
      emptyDescription={`Varlıklar'daki Al/Sat her hisse işlemini buraya da yazar. Geçmişi geri doldurmak için "Geçmiş işlem ekle" ile tarihli alış/satışlarını gir; bunlar yalnız defteri besler, nakit ve Varlıklar satırı değişmez.${stockAssets.length > 0 ? ` Varlıklar'da ${stockAssets.map((a) => `${formatNumber(a.amount)} ${a.symbol ?? a.name}`).join(', ')} kaydın var.` : ''}`}
      validateForm={(formData, _values, editing, rows) => validateTrade(formData, rows as StockTrade[], editing as StockTrade | null)}
      getInitialValues={(row?: StockTrade) => ({
        symbol: row?.symbol ?? (stockAssets[0]?.symbol ?? ''),
        kind: row?.kind ?? 'buy',
        trade_date: row?.trade_date ?? dateInputValue(new Date()),
        quantity: row?.quantity ?? 1,
        unit_price: row?.unit_price ?? '',
        fee: row?.fee ?? 0,
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId, editing) => {
        const symbol = normalizeTicker(String(formData.get('symbol') ?? '')) ?? ''
        const asset = stockAssets.find((row) => row.symbol === symbol) ?? null
        return {
          user_id: userId,
          asset_id: asset?.id ?? (editing as StockTrade | null)?.asset_id ?? null,
          symbol,
          kind: (formData.get('kind') as StockTradeKind) || 'buy',
          trade_date: String(formData.get('trade_date') ?? ''),
          quantity: parseNumber(formData.get('quantity')),
          unit_price: optionalNumber(formData, 'unit_price'),
          fee: optionalNumber(formData, 'fee') ?? 0,
          source: (editing as StockTrade | null)?.source === 'trade_rpc' ? 'trade_rpc' : 'manual',
          note: String(formData.get('note') ?? '') || null,
        }
      }}
      renderBeforeList={({ loading, rows, reload }) => {
        const trades = rows as StockTrade[]
        return (
          <div className="space-y-3">
            <RatesBanner onSynced={reload} />
            {!loading ? <BorsaSection trades={trades} assets={stockAssets} /> : null}
          </div>
        )
      }}
      renderTitle={(row) => `${row.symbol} ${KIND_LABELS[row.kind].toLocaleLowerCase('tr-TR')}`}
      renderSubtitle={(row) => formatDate(row.trade_date)}
      renderDetails={(row) => [`Adet: ${formatNumber(row.quantity)}`]}
      renderCard={(row, { menu, rows }) => {
        const trade = row as StockTrade
        const realized = annotateRealized(rows as StockTrade[]).find((r) => r.trade === trade)?.realized ?? null
        return <TradeCard trade={trade} realized={realized} menu={menu} />
      }}
    />
  )
}

/** Canlı fiyatları defterdeki sembollerden toplar; overview'a geçirir. */
function BorsaSection({ trades, assets }: { trades: StockTrade[]; assets: Asset[] }) {
  const symbols = useMemo(() => Array.from(new Set([...trades.map((row) => row.symbol), ...assets.map((a) => a.symbol).filter((s): s is string => Boolean(s))])), [trades, assets])
  const prices = useStockPrices(symbols)
  return <BorsaOverview trades={trades} assets={assets} prices={prices} />
}
