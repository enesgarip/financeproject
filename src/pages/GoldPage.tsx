import { Coins } from 'lucide-react'
import { useMemo, useEffect, useRef } from 'react'
import { useAuth } from '../auth/useAuth'
import { CrudPage, type FormField } from '../components/CrudPage'
import { LineChart } from '../components/charts/LineChart'
import { RatesBanner } from '../components/finance/RatesBanner'
import { SectionHeader } from '../components/finance/FinanceUI'
import { Delta, HeroNumber, LineGroup, LineRow, SERIT_TEXT } from '../components/serit'
import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { useMarketRates } from '../hooks/useMarketRates'
import type { GoldDirection, GoldLot, GoldType } from '../types/database'
import { formatNumber, parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import {
  GOLD_TYPE_LABELS,
  GOLD_TYPE_UNIT,
  buildGoldAccumulation,
  summarizeGold,
  summarizeGoldType,
  type GoldTypeSummary,
} from '../utils/goldLedger'
import { syncGoldLedgerAssets } from '../utils/goldLedgerSync'
import type { MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, roundTL as round2, sumTL } from '../utils/money'
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

function GoldOverview({ rows, snapshot }: { rows: GoldLot[]; snapshot: MarketRatesSnapshot | null }) {
  const summaries = useMemo(() => summarizeGold(rows), [rows])
  if (summaries.length === 0) return null

  const totalKnownCost = sumTL(summaries.map((summary) => summary.knownCost))
  const totalLiveValue = sumGoldValues(summaries, snapshot, 'totalQuantity')
  const knownLiveValue = sumGoldValues(summaries, snapshot, 'knownQuantity')
  const profit = knownLiveValue === null || totalKnownCost <= 0 ? null : diffTL(knownLiveValue, totalKnownCost)
  const profitPct = profit === null || totalKnownCost <= 0 ? null : round2((profit / totalKnownCost) * 100)
  const gramSummary = summaries.find((summary) => summary.goldType === 'gram')
  const ceyrekSummary = summaries.find((summary) => summary.goldType === 'ceyrek')
  const unknownSummaries = summaries.filter((summary) => summary.unknownQuantity > 0)

  // Şerit: kahraman = güncel piyasa değeri; kâr/zarar Delta satırı, birikim
  // ve maliyet çizgi listesi. MetricCard ızgarası (4 kutu) kaldırıldı.
  return (
    <section>
      {/* Kur yokken kahraman rakam "0 ₺" gösteriyordu: eldeki altın duruyorken
          ekran "hiç değeri yok" diyor, hemen altındaki açıklama ise "kur
          bekleniyor" diyordu — rakam ile cümle çelişiyordu (denetim 2026-08-12 §5).
          Kur gelene kadar sayı yerine BEKLEME durumu gösterilir; birikim ve maliyet
          satırları aşağıda zaten görünür. */}
      {totalLiveValue === null ? (
        <div>
          <p className="uppercase text-ink-faint" style={{ fontSize: 12, letterSpacing: '0.1em', lineHeight: '16px' }}>
            Altın güncel değer
          </p>
          <p className="mt-2 text-[22px] font-semibold leading-tight text-ink lg:text-[26px]">Kur bekleniyor</p>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {rows.length} işlem kayıtlı · canlı alış kuru gelince güncel değer hesaplanacak.
          </p>
        </div>
      ) : (
        <HeroNumber
          label="Altın güncel değer"
          value={totalLiveValue}
          description={`${rows.length} işlem · canlı alış kuruyla`}
        />
      )}

      {profit === null ? null : <Delta value={profit} percent={profitPct ?? undefined} suffix="kayıtlı maliyet üzerinden" />}

      <div className="mt-5">
        <LineGroup>
          <LineRow
            title="Birikim"
            subtitle={[
              gramSummary ? formatQuantity(gramSummary.totalQuantity, 'gram') : null,
              ceyrekSummary ? formatQuantity(ceyrekSummary.totalQuantity, 'ceyrek') : null,
            ].filter(Boolean).join(' · ') || 'Kayıt yok'}
          />
          <LineRow title="Toplam maliyet" subtitle="maliyeti kayıtlı alımlar" amount={totalKnownCost} />
        </LineGroup>
      </div>

      {unknownSummaries.length > 0 ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px]" style={{ color: SERIT_TEXT.warning }}>
          {unknownSummaries
            .map((summary) => `${formatQuantity(summary.unknownQuantity, summary.goldType)} maliyeti kayıtsız`)
            .join(' · ')}
          . Adet toplamda sayılıyor; ortalama maliyet ve kâr/zarar sadece maliyeti kayıtlı işlemlerden hesaplanıyor.
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
          <div className="flex h-52 items-center justify-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
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
  const { formatAmount } = useBalancePrivacy()
  const { snapshot } = useMarketRates()

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
      emptyDescription="Gram veya çeyrek alımlarını işlem olarak ekleyince toplam adet, ortalama maliyet ve net değer otomatik güncellenir."
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
            {!loading ? <GoldOverview rows={goldRows} snapshot={snapshot} /> : null}
            {!loading ? <GoldAccumulationChart rows={goldRows} snapshot={snapshot} /> : null}
          </div>
        )
      }}
      renderTitle={(row) => `${GOLD_TYPE_LABELS[row.gold_type]}${row.direction === 'sell' ? ' (satış)' : ''}`}
      renderSubtitle={(row) => formatDate(row.purchase_date)}
      renderDetails={(row) => [`Miktar: ${formatQuantity(row.quantity, row.gold_type)}`]}
      renderCard={(row, { menu }) => {
        const lot = row as GoldLot
        const totalCost = lot.unit_price == null ? null : round2(lot.quantity * lot.unit_price)
        const noCost = lot.unit_price == null

        return (
          <article className={`premium-entity-card gold-entity-card relative overflow-hidden rounded-2xl border p-4 transition-[border-color,box-shadow,transform] duration-250 hover:-translate-y-0.5 min-[390px]:p-5 ${noCost ? 'border-warning/35' : 'border-warning/22'}`}>
            <div className="relative flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3.5">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-warning/14 text-warning ring-1 ring-warning/16">
                  <Coins className="size-5.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-bold tracking-tight text-foreground">
                    {GOLD_TYPE_LABELS[lot.gold_type]}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{formatDate(lot.purchase_date)}</p>
                    <Badge variant={lot.direction === 'sell' ? 'destructive' : 'secondary'}>
                      {lot.direction === 'sell' ? 'Satış' : 'Alım'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="entity-card-menu">{menu}</div>
            </div>

            <div className="gold-value-well relative mt-5 overflow-hidden rounded-2xl border border-warning/18 bg-warning/[0.055] p-4 dark:bg-warning/[0.075]">
              <p className="finance-label">{lot.direction === 'sell' ? 'Satış toplamı' : 'İşlem toplamı'}</p>
              <p className={`finance-value mt-2 truncate text-[clamp(1.65rem,6vw,2.35rem)] font-bold leading-none tracking-tight ${noCost ? 'text-muted-foreground' : 'text-foreground'}`}>
                {totalCost == null ? 'Maliyet bilinmiyor' : formatAmount(totalCost)}
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="finance-field min-w-0 rounded-xl px-3 py-2.5">
                <p className="finance-label">Miktar</p>
                <p className="finance-value mt-1.5 truncate text-base font-bold text-foreground">{formatQuantity(lot.quantity, lot.gold_type)}</p>
              </div>
              <div className="finance-field min-w-0 rounded-xl px-3 py-2.5">
                <p className="finance-label">{lot.direction === 'sell' ? 'Birim fiyat' : 'Birim maliyet'}</p>
                <p className={`finance-value mt-1.5 truncate text-base font-bold ${noCost ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {noCost ? 'Bilinmiyor' : formatAmount(lot.unit_price!)}
                </p>
              </div>
            </div>

            {noCost ? (
              <p className="mt-3 rounded-xl border border-warning/20 bg-warning/8 px-3 py-2.5 text-xs font-semibold text-warning">
                Maliyet bilinmiyor — adede dahil, kâr/zarar hesabına dahil değil.
              </p>
            ) : null}
            {lot.note ? <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{lot.note}</p> : null}
          </article>
        )
      }}
      groupBy={(row) => GOLD_TYPE_LABELS[row.gold_type]}
      listGridClassName="grid gap-4 min-[680px]:grid-cols-2 xl:grid-cols-2"
    />
  )
}
