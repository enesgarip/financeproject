/**
 * Analiz ekranının kahraman rakamı — Şerit (`3c`): **net değer**, aylık delta,
 * 12 aylık trend ve bileşen kırılımı (varlık / borç / bekleyen tahsilat).
 *
 * Trend `net_worth_snapshots`'tan gelir (günlük fotoğraf, aylık agregasyon).
 * Snapshot yoksa çubuk çizilmez — uydurma seri üretmiyoruz.
 */
import type { NetWorthSnapshot } from '../types/database'
import { buildFinancialPosition, type FinanceSummaryInput } from '../utils/financeSummary'
import { aggregateNetWorthByMonth } from '../utils/netWorthSeries'
import { diffTL } from '../utils/money'
import { Delta, HeroNumber, LineGroup, LineRow, SectionEyebrow, TrendBars } from '../components/serit'

const TREND_MONTHS = 12

export function AnalysisHero({
  data,
  snapshots,
}: {
  data: FinanceSummaryInput
  snapshots: NetWorthSnapshot[]
}) {
  const position = buildFinancialPosition(data)
  const monthly = aggregateNetWorthByMonth(snapshots).slice(-TREND_MONTHS)

  // Delta ölçüsü: bir önceki AY SONU fotoğrafı ile bugünkü hesaplanan net değer.
  // Son fotoğraf bugüne aitse onu değil bir öncekini alıyoruz, aksi halde fark
  // her zaman ~0 çıkardı.
  const previous = monthly.length >= 2 ? monthly[monthly.length - 2].net_worth : null
  const delta = previous === null ? null : diffTL(position.netWorth, previous)
  const deltaPct = previous !== null && previous !== 0 ? (delta! / Math.abs(previous)) * 100 : undefined

  return (
    <section className="lg:col-span-12">
      <HeroNumber
        label="Net değer"
        value={position.netWorth}
        description={
          monthly.length < 2 ? 'Trend için en az iki aylık fotoğraf gerekiyor; her açılışta bir tane alınıyor.' : undefined
        }
      />

      {delta === null ? null : <Delta value={delta} percent={deltaPct} suffix="geçen ay sonuna göre" />}

      {monthly.length >= 2 ? (
        <div className="mt-4">
          <TrendBars
            values={monthly.map((snapshot) => snapshot.net_worth)}
            label={`Son ${monthly.length} ayın net değer trendi`}
          />
          <div className="mt-2 flex justify-between text-[10.5px] text-ink-ghost">
            {monthly
              .filter((_, index) => index === 0 || index === monthly.length - 1 || index % Math.ceil(monthly.length / 4) === 0)
              .map((snapshot) => (
                <span key={snapshot.snapshot_date} className="serit-num">
                  {snapshot.snapshot_date.slice(5, 7)}.{snapshot.snapshot_date.slice(2, 4)}
                </span>
              ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <SectionEyebrow className="mb-1">Bileşenler</SectionEyebrow>
        <LineGroup>
          <LineRow title="Varlıklar" subtitle="Nakit, yatırım ve banka" amount={position.totalAssets} />
          <LineRow
            title="Borçlar"
            subtitle="Kart, kredi, kişisel ve planlı"
            amount={-position.totalDebts}
            amountTone="danger"
          />
          {position.totalReceivables > 0 ? (
            <LineRow
              title="Bekleyen tahsilat"
              subtitle="Henüz girmemiş alacak"
              amount={position.totalReceivables}
              amountOptions={{ signed: true }}
              amountTone="info"
            />
          ) : null}
        </LineGroup>
      </div>
    </section>
  )
}
