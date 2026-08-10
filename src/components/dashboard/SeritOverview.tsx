/**
 * Özet ekranının Şerit dilindeki gövdesi (`2a` mobil, `4e` masaüstü iki kolon).
 *
 * Kural gereği burada kart YOK: ayrım çizgi ve zemin tonuyla yapılır. İzin verilen
 * tek yükseltilmiş blok ay şeridi (grafik) ve mobildeki "sıradaki üç vade" grubudur.
 *
 * Hesap yok — her sayı DashboardPage'den hazır gelir; burası yalnız sunum.
 */
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'
import type { MonthStrip } from '../../utils/dashboardMonthStrip'
import { monthStripTone } from '../../utils/dashboardMonthStrip'
import type { DashboardUpcomingItem } from '../../utils/dashboardUpcoming'
import type { SafeToSpendResult } from '../../utils/safeToSpend'
import { daysUntil } from '../../utils/date'
import { formatPercent } from '../../utils/formatCurrency'
import {
  BreakdownBar,
  DayBadge,
  HeroNumber,
  LineGroup,
  LineRow,
  ScreenHeader,
  SectionEyebrow,
  SERIT_TEXT,
  useSeritAmount,
  type SeritTone,
} from '../serit'
import { SeritBufferRow } from './SeritBufferRow'
import { SeritMonthStrip } from './SeritMonthStrip'

export type SeritLiquidAccount = { id: string; name: string; subtitle?: string; amount: number }

const BADGE_TONE: Record<ReturnType<typeof monthStripTone>, SeritTone> = {
  statement: 'danger',
  installment: 'warning',
  planned: 'neutral',
  income: 'brand',
}

/** "3g" / "12g" — vadeye kalan gün. Bugün ve geçmiş için ayrı kısaltma. */
function remainingLabel(item: DashboardUpcomingItem) {
  const days = daysUntil(new Date(item.sortTime))
  if (days === null) return '—'
  if (days < 0) return 'geçti'
  if (days === 0) return 'bugün'
  return `${days}g`
}

function remainingSentence(item: DashboardUpcomingItem) {
  const days = daysUntil(new Date(item.sortTime))
  if (days === null) return '—'
  if (days < 0) return 'gecikti'
  if (days === 0) return 'bugün'
  return `${days} gün`
}

/** `2026-08-13` → `13.08`; masaüstü tablosunun 56px'lik mono tarih sütunu. */
function shortDate(iso: string) {
  const [, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}`
}

export function SeritOverview({
  monthLabel,
  today,
  daysInMonth,
  safeToSpend,
  buffer,
  onBufferChange,
  perDayAllowance,
  strip,
  upcoming,
  cardBuckets,
  creditUsageRate,
  totalCreditLimit,
  netWorth,
  totalAssets,
  totalDebts,
  liquidAccounts,
  totalCashAssets,
  health,
  onPay,
}: {
  monthLabel: string
  today: Date
  daysInMonth: number
  safeToSpend: SafeToSpendResult
  buffer: number
  onBufferChange: (value: number) => void
  perDayAllowance: number
  strip: MonthStrip
  upcoming: DashboardUpcomingItem[]
  cardBuckets: { statement: number; current: number; provision: number; total: number }
  creditUsageRate: number
  totalCreditLimit: number
  netWorth: number
  totalAssets: number
  totalDebts: number
  liquidAccounts: SeritLiquidAccount[]
  totalCashAssets: number
  /** `total` = errors + warnings (bulgu toplamı), yapılan kontrol sayısı DEĞİL. */
  health: { errors: number; warnings: number; total: number }
  onPay: (item: DashboardUpcomingItem) => void
}) {
  const format = useSeritAmount()
  const daysLeft = daysInMonth - today.getDate()
  const perDay = format(perDayAllowance)
  const nextThree = upcoming.slice(0, 3)

  return (
    <div className="lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-start lg:gap-9">
      {/* ── Sol kolon: kahraman rakam, şerit, vadeler ── */}
      <div className="min-w-0">
        <ScreenHeader eyebrow={monthLabel} context={`${today.getDate()} / ${daysInMonth} gün`} />

        <div className="mt-4">
          <HeroNumber
            label="Ay sonuna kalan"
            value={safeToSpend.amount}
            tone={safeToSpend.negativeCause === 'obligations' ? 'danger' : 'ink'}
            description={
              safeToSpend.negativeCause === 'obligations' ? (
                'Bu ayın kalan yükümlülükleri eldeki parayı aşıyor.'
              ) : (
                <>
                  {daysLeft} gün kaldı · günde{' '}
                  <span className="serit-num font-semibold" style={{ color: SERIT_TEXT.brand }}>
                    {perDay.amount} {perDay.unit}
                  </span>{' '}
                  harcayabilirsin.
                </>
              )
            }
          />
        </div>

        <div className="mt-4">
          <SeritBufferRow buffer={buffer} onChange={onBufferChange} />
        </div>

        <div className="mt-5">
          <SeritMonthStrip strip={strip} monthLabel={monthLabel} />
        </div>

        {/* Mobil: sıradaki üç vade, yükseltilmiş grup. */}
        <section className="mt-6 lg:hidden">
          <SectionEyebrow className="mb-2.5">Sıradaki üç vade</SectionEyebrow>
          {nextThree.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Ayın kalanında planlı vade yok.</p>
          ) : (
            <LineGroup variant="raised">
              {nextThree.map((item) => (
                <LineRow
                  key={item.id}
                  lead={<DayBadge tone={BADGE_TONE[monthStripTone(item.obligation.kind)]}>{remainingLabel(item)}</DayBadge>}
                  title={item.title}
                  subtitle={item.subtitle}
                  amount={item.amount}
                  amountOptions={{ signed: item.direction === 'inflow' }}
                  amountTone={item.direction === 'inflow' ? 'brand' : 'ink'}
                  onClick={item.obligation.action ? () => onPay(item) : undefined}
                />
              ))}
            </LineGroup>
          )}
        </section>

        {/* Masaüstü: 30 günlük vade tablosu. */}
        <section className="mt-7 hidden lg:block">
          <SectionEyebrow>Vadeler · 30 gün</SectionEyebrow>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-muted">Önümüzdeki 30 günde planlı vade yok.</p>
          ) : (
            <table className="mt-1.5 w-full border-collapse">
              <tbody>
                {upcoming.map((item, index) => {
                  const money = format(item.amount, { signed: item.direction === 'inflow' })
                  const inflow = item.direction === 'inflow'
                  const overdue = (daysUntil(new Date(item.sortTime)) ?? 0) < 0
                  return (
                    <tr key={item.id} className={index === upcoming.length - 1 ? undefined : 'border-b border-line'}>
                      <td className="serit-num w-14 py-[13px] text-[12.5px] text-ink-faint">
                        {shortDate(item.obligation.date)}
                      </td>
                      <td className="py-[13px] text-[14.5px] font-semibold text-ink">
                        {item.title}
                        <span className="block text-xs font-normal text-ink-muted">{item.subtitle}</span>
                      </td>
                      <td
                        className="py-[13px] text-[12.5px]"
                        style={{ color: overdue ? SERIT_TEXT.danger : SERIT_TEXT.neutral }}
                      >
                        {remainingSentence(item)}
                      </td>
                      <td
                        className="serit-num py-[13px] text-right text-[17px] font-semibold"
                        style={{ color: inflow ? SERIT_TEXT.brand : SERIT_TEXT.ink }}
                      >
                        {money.amount} {money.unit}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* ── Sağ kolon: ikincil paneller, her biri 1px üst çizgiyle ayrılır ── */}
      <div className="mt-8 flex min-w-0 flex-col gap-6 lg:mt-0 lg:gap-7">
        <SidePanel title="Net değer" first>
          <SideNumber value={netWorth} />
          <p className="mt-1 text-[13px] text-ink-muted">
            <span className="serit-num text-ink">{format(totalAssets).amount}</span> varlık ·{' '}
            <span className="serit-num" style={{ color: SERIT_TEXT.danger }}>
              {format(totalDebts).amount}
            </span>{' '}
            borç
          </p>
        </SidePanel>

        <SidePanel title={`Kart borcu · ${format(cardBuckets.total).amount} ${format(cardBuckets.total).unit}`}>
          <div className="mt-3">
            <BreakdownBar
              height={8}
              segments={[
                { label: 'Ekstre', value: cardBuckets.statement, tone: 'danger' },
                { label: 'Dönem içi', value: cardBuckets.current, tone: 'warning' },
                { label: 'Provizyon', value: cardBuckets.provision, tone: 'info' },
              ]}
            />
          </div>
          {totalCreditLimit > 0 ? (
            <p className="mt-3.5 text-[12.5px] text-ink-muted">
              Limit kullanımı <span className="serit-num font-semibold text-ink">{formatPercent(creditUsageRate)}</span> ·{' '}
              <span className="serit-num">{format(totalCreditLimit).amount}</span> toplam limit
            </p>
          ) : null}
        </SidePanel>

        <SidePanel title={`Likit hesaplar · ${format(totalCashAssets).amount} ${format(totalCashAssets).unit}`}>
          {liquidAccounts.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-muted">Kayıtlı likit hesap yok.</p>
          ) : (
            <LineGroup className="mt-1">
              {liquidAccounts.map((account) => (
                <LineRow key={account.id} title={account.name} subtitle={account.subtitle} amount={account.amount} />
              ))}
            </LineGroup>
          )}
        </SidePanel>

        {/* Renk yalnızca sinyal: temiz geçen kontrol kırmızı/sarı olmaz, jade tik alır. */}
        <div className="border-t border-line-strong pt-4">
          <Link
            to="/veri-sagligi"
            className="flex items-center gap-2.5 rounded-lg text-left transition-colors duration-[120ms] hover:bg-black/[.02] dark:hover:bg-white/[.03]"
          >
            {(() => {
              const tone: SeritTone = health.errors > 0 ? 'danger' : health.warnings > 0 ? 'warning' : 'brand'
              const Icon = tone === 'brand' ? ShieldCheck : ShieldAlert
              return <Icon size={16} className="shrink-0" style={{ color: SERIT_TEXT[tone] }} aria-hidden="true" />
            })()}
            <p className="flex-1 text-[13px] text-ink-muted">
              Veri kontrolü —{' '}
              <span className="font-semibold text-ink">
                {/* `total` yapılan kontrol sayısı değil bulgu toplamı; tasarımdaki
                    "34 kontrol temiz" cümlesi için o sayı henüz üretilmiyor. */}
                {health.total === 0 ? 'tutarsızlık yok' : `${health.warnings} uyarı, ${health.errors} hata`}
              </span>
            </p>
            <span className="shrink-0 text-[13px] font-semibold" style={{ color: SERIT_TEXT.brand }}>
              Aç →
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function SidePanel({ title, first, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <section className={first ? undefined : 'border-t border-line-strong pt-[18px]'}>
      <SectionEyebrow>{title}</SectionEyebrow>
      {children}
    </section>
  )
}

/** Sağ kolonun ikincil rakamı — kahraman değil, 34px. */
function SideNumber({ value }: { value: number }) {
  const format = useSeritAmount()
  const money = format(value)
  return (
    <p className="serit-num mt-2 text-[34px] font-semibold text-ink" style={{ letterSpacing: '-0.03em' }}>
      {money.amount}
      <span className="text-base text-ink-faint"> {money.unit}</span>
    </p>
  )
}
