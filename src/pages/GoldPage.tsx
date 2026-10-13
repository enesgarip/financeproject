import { useMemo, useEffect, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import { CrudPage, type FormField } from '../components/CrudPage'
import { LineChart } from '../components/charts/LineChart'
import { RatesBanner } from '../components/finance/RatesBanner'
import { SectionHeader } from '../components/finance/FinanceUI'
import { Delta, HeroNumber, LineGroup, LineRow, SERIT_TEXT } from '../components/serit'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { QueryError } from '../components/ui/query-error'
import { useMarketRates } from '../hooks/useMarketRates'
import type { Asset, GoldDirection, GoldLot, GoldType } from '../types/database'
import { formatNumber, parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import {
  GOLD_TYPE_LABELS,
  GOLD_TYPE_UNIT,
  buildGoldAccumulation,
  summarizeGoldType,
} from '../utils/goldLedger'
import { syncGoldLedgerAssets } from '../utils/goldLedgerSync'
import { buildGoldHoldings } from '../utils/goldHoldings'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { roundTL as round2, sumTL } from '../utils/money'
import { valueAsset } from '../utils/valuation'

const goldFields: FormField[] = [
  {
    name: 'direction',
    label: 'İşlem türü',
    type: 'select',
    options: [
      { label: 'Alım', value: 'buy' },
      { label: 'Satım', value: 'sell' },
    ],
  },
  { name: 'purchase_date', label: 'Tarih', type: 'date' },
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
    hint: () => 'Alımda ödenen, satımda alınan birim fiyat. Boş bırakırsan adet sayılır.',
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

function buildChartData(lots: GoldLot[], snapshot: MarketRatesSnapshot | null): ChartPoint[] {
  const dated = lots
    .filter((lot) => lot.purchase_date)
    .sort((a, b) => String(a.purchase_date).localeCompare(String(b.purchase_date)))

  // Maliyet çizgisi ağırlıklı-ortalama havuzdan gelir (buildGoldAccumulation —
  // özet kartıyla AYNI yöntem). Eski yerel kopya satışta maliyetten satış
  // fiyatını düşüyordu; kârlı satış maliyet çizgisini 0'ın altına bile
  // itebiliyordu (denetim 2026-08-12 K5). Accumulation aynı filtre + aynı
  // sıralamayla üretildiği için indeksler `dated` ile birebir hizalı.
  const accumulation = buildGoldAccumulation(lots)

  let gram = 0
  let ceyrek = 0

  return dated.map((lot, index) => {
    const sign = lot.direction === 'sell' ? -1 : 1
    if (lot.gold_type === 'gram') gram += lot.quantity * sign
    if (lot.gold_type === 'ceyrek') ceyrek += lot.quantity * sign

    const gramValue = goldValue('gram', gram, snapshot)
    const ceyrekValue = goldValue('ceyrek', ceyrek, snapshot)

    return {
      date: String(lot.purchase_date),
      label: formatDate(lot.purchase_date),
      gram: round2(gram),
      ceyrek: round2(ceyrek),
      cost: accumulation[index]?.cumulativeCost ?? 0,
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

function GoldOverview({ rows, assets, snapshot }: { rows: GoldLot[]; assets: Asset[]; snapshot: MarketRatesSnapshot | null }) {
  const { formatAmount, hidden } = useBalancePrivacy()
  const overview = useMemo(() => buildGoldHoldings(rows, assets, snapshot), [rows, assets, snapshot])
  if (overview.holdings.length === 0) return null

  const { totalKnownCost, totalValue: totalLiveValue, profit, holdings } = overview
  const profitPct = profit === null || totalKnownCost <= 0 ? null : round2((profit / totalKnownCost) * 100)
  const unknownSummaries = holdings.filter((summary) => summary.unknownQuantity > 0)
  const valueSource = overview.usesStoredValue ? 'son kayıtlı değerle' : 'canlı alış kuruyla'
  const displayQuantity = (quantity: number, type: GoldType) => hidden ? '••••' : formatQuantity(quantity, type)

  // Şerit: kahraman = güncel piyasa değeri; kâr/zarar Delta satırı, birikim
  // ve maliyet çizgi listesi. MetricCard ızgarası (4 kutu) kaldırıldı.
  return (
    <section aria-label="Altın özeti">
      {/* Kur yokken kahraman rakam "0 ₺" gösteriyordu: eldeki altın duruyorken
          ekran "hiç değeri yok" diyor, hemen altındaki açıklama ise "kur
          bekleniyor" diyordu — rakam ile cümle çelişiyordu (denetim 2026-08-12 §5).
          Kur gelene kadar sayı yerine BEKLEME durumu gösterilir; birikim ve maliyet
          satırları aşağıda zaten görünür. */}
      {totalLiveValue === null ? (
        <div>
          <p className="uppercase text-ink-faint" style={{ fontSize: 12, letterSpacing: '0.1em', lineHeight: '16px' }}>
            Toplam tahmini eder
          </p>
          <p className="mt-2 text-[22px] font-semibold leading-tight text-ink lg:text-[26px]">Kur bekleniyor</p>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {rows.length} işlem kayıtlı · canlı alış kuru gelince güncel değer hesaplanacak.
          </p>
        </div>
      ) : (
        <HeroNumber
          label="Toplam tahmini eder"
          value={totalLiveValue}
          description={`${overview.source === 'ledger' ? `${rows.length} işlem` : 'Varlık kayıtlarına göre'} · ${valueSource}`}
        />
      )}

      {profit === null ? null : <Delta value={profit} percent={profitPct ?? undefined} suffix="kayıtlı maliyet üzerinden" />}

      <div className="mt-5">
        <LineGroup>
          <LineRow
            title="Toplam miktar"
            subtitle={holdings.map((holding) => displayQuantity(holding.quantity, holding.goldType)).join(' · ')}
          />
          <LineRow
            title="Bilinen maliyet"
            subtitle="elde kalan altının kayıtlı maliyeti"
            amount={holdings.some((holding) => holding.knownQuantity > 0) ? totalKnownCost : undefined}
            trailing={holdings.every((holding) => holding.knownQuantity === 0) ? <span className="text-sm text-ink-muted">Bilinmiyor</span> : undefined}
          />
        </LineGroup>
      </div>

      <LineGroup className="mt-3">
        {holdings.map((holding) => (
          <div key={holding.goldType} className="py-4">
            <h2 className="text-sm font-semibold text-ink">{GOLD_TYPE_LABELS[holding.goldType]}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="min-w-0"><dt className="text-xs text-ink-muted">Eldeki miktar</dt><dd className="serit-num mt-1 break-words text-sm font-semibold text-ink">{displayQuantity(holding.quantity, holding.goldType)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-muted">Kayıtlı ayarlar</dt><dd className="mt-1 text-sm font-semibold text-ink">{holding.ayars.length === 0 ? 'Belirtilmedi' : [...holding.ayars.map((ayar) => `${ayar} ayar`), ...(holding.hasUnspecifiedAyar ? ['Bazıları belirtilmedi'] : [])].join(' · ')}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-muted">Güncel eder</dt><dd className="serit-num mt-1 break-words text-sm font-semibold text-ink">{holding.value === null ? 'Kur bekleniyor' : formatAmount(holding.value)}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-muted">Ortalama birim maliyet</dt><dd className="serit-num mt-1 break-words text-sm font-semibold text-ink">{holding.avgUnitCost === null ? 'Bilinmiyor' : formatAmount(holding.avgUnitCost)}</dd></div>
            </dl>
          </div>
        ))}
      </LineGroup>
      <p className="text-xs leading-relaxed text-ink-muted">Kayıtlı ayarlar işlem bilgilerini gösterir. Tahmini eder gram/çeyrek alış kuruyla hesaplanır; ayar farkı değerlemeye dahil değildir.</p>

      {unknownSummaries.length > 0 ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px]" style={{ color: SERIT_TEXT.warning }}>
          {unknownSummaries
            .map((summary) => `${displayQuantity(summary.unknownQuantity, summary.goldType)} maliyeti kayıtsız`)
            .join(' · ')}
          . Ortalama maliyet ve kâr/zarar yalnız maliyeti bilinen miktarı kapsar.
        </p>
      ) : null}
    </section>
  )
}

const GOLD_CHART_SERIES = [
  { key: 'cost', name: 'Bilinen maliyet', stroke: 'var(--warning)' },
  { key: 'market', name: 'Piyasa değeri', stroke: 'var(--success)', connectNulls: true },
]

function GoldAccumulationChart({ rows, snapshot }: { rows: GoldLot[]; snapshot: MarketRatesSnapshot | null }) {
  const data = useMemo(() => buildChartData(rows, snapshot), [rows, snapshot])
  const undatedCount = rows.filter((row) => !row.purchase_date).length
  const hasMarket = data.some((point) => point.market !== null)
  const series = hasMarket ? GOLD_CHART_SERIES : GOLD_CHART_SERIES.slice(0, 1)

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
          <div className="flex h-52 items-center justify-center rounded-xl bg-page text-sm text-ink-muted">
            Tarihli işlem yok
          </div>
        ) : (
          <LineChart data={data} series={series} height={260} />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Satışta eldekinden fazla miktar girilebiliyordu: `summarizeGoldType` negatif
 * birikimi sessizce 0'a kırpıyor, yani 5 gram varken 50 gram satışı kabul edilip
 * defter "0 gram" gösteriyordu (denetim 2026-08-12 §5).
 *
 * Kural elde kalan miktar üzerinden kurulur ve DÜZENLEMEDE düzenlenen satırın
 * kendi etkisi geri alınır (aksi halde mevcut bir satış kaydını kaydetmek
 * kendi kendini reddederdi).
 */
function validateGoldLot(formData: FormData, rows: GoldLot[], editing: GoldLot | null): Record<string, string> {
  const errors: Record<string, string> = {}
  const quantity = parseNumber(formData.get('quantity'))
  if (quantity <= 0) {
    errors.quantity = 'Miktar 0’dan büyük olmalı.'
    return errors
  }

  if (formData.get('direction') !== 'sell') return errors

  const goldType = formData.get('gold_type') as GoldType
  const others = editing ? rows.filter((row) => row.id !== editing.id) : rows
  const held = summarizeGoldType(others, goldType).totalQuantity

  if (quantity > held) {
    errors.quantity = `${GOLD_TYPE_LABELS[goldType]} olarak elinde ${formatQuantity(held, goldType)} var; bundan fazlasını satamazsın.`
  }

  return errors
}

export function GoldPage() {
  const { formatAmount, hidden, maskText } = useBalancePrivacy()
  const { snapshot } = useMarketRates()
  // Varlıklar sekmesinde "Gram altın" kaydı varken burada "Henüz altın işlemi yok"
  // iki ayrı gerçek gibi okunuyordu (UX turu B13): boş durumda köprü kur.
  const snapshotQuery = useFinanceSnapshot()
  const goldAssets = (snapshotQuery.data?.assets ?? []).filter((asset) => asset.category === 'Altın')
  const goldAssetNote = goldAssets.length > 0 ? ' Mevcut altınlarının miktarını ve ederini yukarıdaki özette görebilirsin.' : ''

  return (
    <CrudPage
      table="gold_lots"
      pageTitle="Altın"
      pageLabel="Değer saklama"
      pageDescription="Alım ve satım geçmişini maliyet, miktar ve güncel piyasa değeriyle birlikte izle."
      addLabel="Alım / satım ekle"
      fields={goldFields}
      orderBy="purchase_date"
      orderAscending={false}
      emptyTitle="Henüz altın işlemi yok"
      emptyDescription={`Alım ve satım geçmişini ekleyince miktar ve maliyeti bu kayıtlardan takip edebilirsin.${goldAssetNote}`}
      validateForm={(formData, _values, editing, rows) => validateGoldLot(formData, rows as GoldLot[], editing as GoldLot | null)}
      getInitialValues={(row?: GoldLot) => ({
        direction: row?.direction ?? 'buy',
        purchase_date: row?.purchase_date ?? '',
        gold_type: row?.gold_type ?? 'gram',
        ayar: row?.ayar ?? '',
        quantity: row?.quantity ?? 1,
        unit_price: row?.unit_price ?? '',
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        direction: (formData.get('direction') as GoldDirection) || 'buy',
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
            {!loading ? <GoldOverview rows={goldRows} assets={goldAssets} snapshot={snapshot} /> : null}
            {!loading && goldRows.length === 0 && snapshotQuery.isError ? <QueryError title="Altın varlıkları yüklenemedi" message="Toplam miktar ve eder doğrulanamadı." onRetry={() => void snapshotQuery.refetch()} /> : null}
            {!loading && goldRows.length > 0 ? (
              <details className="border-y border-line py-3">
                <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-ink">Birikim grafiği</summary>
                <GoldAccumulationChart rows={goldRows} snapshot={snapshot} />
              </details>
            ) : null}
          </div>
        )
      }}
      renderTitle={(row) => `${GOLD_TYPE_LABELS[row.gold_type]}${row.direction === 'sell' ? ' (satım)' : ''}`}
      renderSubtitle={(row) => formatDate(row.purchase_date)}
      renderDetails={(row) => [`Miktar: ${formatQuantity(row.quantity, row.gold_type)}`, row.ayar === null ? 'Ayar belirtilmedi' : `${row.ayar} ayar`]}
      renderCard={(row, { menu }) => {
        const lot = row as GoldLot
        const totalCost = lot.unit_price == null ? null : round2(lot.quantity * lot.unit_price)
        const noCost = lot.unit_price == null

        return (
          <article className="flex items-start gap-2 border-b border-line py-3">
            <div className="grid min-w-0 flex-1 gap-x-5 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-sm font-semibold text-ink">{lot.direction === 'sell' ? 'Satım' : 'Alım'}</h2>
                <span className="serit-num text-sm text-ink">{hidden ? '••••' : formatQuantity(lot.quantity, lot.gold_type)}</span>
                <span className="text-xs text-ink-muted">{lot.ayar === null ? 'Ayar belirtilmedi' : `${lot.ayar} ayar`}</span>
                <span className="text-xs text-ink-muted">{formatDate(lot.purchase_date)}</span>
              </div>
              <p className="serit-num break-words text-sm font-semibold text-ink sm:text-right">
                <span className="sr-only">İşlem toplamı: </span>
                {totalCost == null ? 'Tutar bilinmiyor' : formatAmount(totalCost)}
              </p>
              <p className="text-xs text-ink-muted sm:col-span-2">
                {noCost
                  ? 'Maliyet bilinmiyor · miktara dahil, kâr/zarara dahil değil.'
                  : `Birim ${lot.direction === 'sell' ? 'fiyat' : 'maliyet'}: ${formatAmount(lot.unit_price!)}`}
              </p>
              {lot.note ? <p className="break-words text-xs leading-relaxed text-ink-muted sm:col-span-2">{maskText(lot.note)}</p> : null}
            </div>
            <div className="shrink-0">{menu}</div>
          </article>
        )
      }}
      groupBy={(row) => GOLD_TYPE_LABELS[row.gold_type]}
      listGridClassName="grid-cols-1 gap-0 min-[760px]:grid-cols-1 xl:grid-cols-1"
    />
  )
}
