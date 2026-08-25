import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { BarChart, type BarDataPoint } from '../components/charts/BarChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import type { NetWorthSnapshot } from '../types/database'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { MoneyInput } from '../components/finance/MoneyInput'
import { buildCashFlowForecast, salaryCutRunwayMonths } from '../utils/cashFlowForecast'
import { analysisFinanceSummaryInput, type AnalysisData } from '../utils/analysisView'
import { parseNumber } from '../utils/formatCurrency'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL } from '../utils/money'
import { convertNetWorth, formatRealValue, realValueChangeBadge, type RealUnit, REAL_UNIT_LABELS } from '../utils/realValue'
import { selectNetWorthSeries, type NetWorthRange } from '../utils/netWorthSeries'
import {
  applyScenario,
  loanPayoffAmount,
  payoffBreakEvenMonthKey,
  scenarioStartingCashDelta,
  type ScenarioMutation,
} from '../utils/scenarioForecast'
import { StatPill } from './AnalysisPage.atoms'

export function NetWorthTrend({
  snapshots,
  ratesSnapshot,
}: {
  snapshots: NetWorthSnapshot[]
  ratesSnapshot: MarketRatesSnapshot | null
}) {
  const { formatAmount } = useBalancePrivacy()
  const [unit, setUnit] = useState<RealUnit>('TRY')
  const [range, setRange] = useState<NetWorthRange>('90d')
  const { series: derived, aggregated } = useMemo(
    () => selectNetWorthSeries(snapshots, range, new Date()),
    [snapshots, range],
  )
  // Seçilen aralıkta <2 nokta varsa (ör. yeni veri) tüm seriye düş.
  const view = derived.length >= 2 ? derived : snapshots

  if (snapshots.length < 2) {
    return (
      <Card className="border-line-strong lg:col-span-12">
        <CardHeader className="pb-0">
          <CardTitle>Net değer trendi</CardTitle>
          <p className="mt-1 text-sm text-ink-muted">Geçmişe dönük net değer değişimi.</p>
        </CardHeader>
        <CardContent className="pt-3">
          <p className="rounded-xl bg-page p-4 text-sm text-ink-muted">
            Net değer fotoğrafı her gün uygulama açıldığında alınır; birkaç günlük veri birikince grafik burada görünür.
          </p>
        </CardContent>
      </Card>
    )
  }

  const latest = snapshots.at(-1)! // Güncel = gerçek son değer (aralıktan bağımsız)
  const first = view[0]!
  const spansDifferentYears = new Date(first.snapshot_date).getFullYear() !== new Date(latest.snapshot_date).getFullYear()

  // Current rates for stat pills (always use live rates for "güncel" display)
  const currentRates = {
    goldTry: ratesSnapshot?.rates?.GRA?.buying ?? null,
    usdTry: ratesSnapshot?.rates?.USD?.buying ?? null,
  }

  // Per-snapshot rates: use stored rate when available, fall back to current
  function snapshotRates(s: NetWorthSnapshot) {
    return {
      goldTry: s.gold_try ?? currentRates.goldTry,
      usdTry: s.usd_try ?? currentRates.usdTry,
    }
  }

  function convertSnapshot(s: NetWorthSnapshot): number | null {
    return convertNetWorth(s.net_worth, unit, snapshotRates(s))
  }

  function displayValue(tryAmount: number, rates: { goldTry?: number | null; usdTry?: number | null }): string {
    if (unit === 'TRY') return formatAmount(tryAmount)
    const converted = convertNetWorth(tryAmount, unit, rates)
    if (converted === null) return '—'
    return formatRealValue(converted, unit)
  }

  function snapshotLabel(s: NetWorthSnapshot) {
    const d = new Date(`${s.snapshot_date}T00:00:00`)
    const month = new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(d)
    return spansDifferentYears ? `${month} '${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${month}`
  }

  const barData: BarDataPoint[] = view.map((s) => ({
    label: snapshotLabel(s),
    value: convertSnapshot(s) ?? 0,
  }))

  const latestConverted = convertNetWorth(latest.net_worth, unit, currentRates)
  const firstConverted = convertNetWorth(first.net_worth, unit, snapshotRates(first))
  const minSnap = view.reduce((a, b) => (b.net_worth < a.net_worth ? b : a))
  const maxSnap = view.reduce((a, b) => (b.net_worth > a.net_worth ? b : a))

  const changeTry = diffTL(latest.net_worth, first.net_worth)
  const changeBadge =
    unit === 'TRY'
      ? `${changeTry >= 0 ? '+' : ''}${formatAmount(changeTry)}`
      : (realValueChangeBadge(changeTry, unit, currentRates) ??
        (latestConverted !== null && firstConverted !== null
          ? `${latestConverted - firstConverted >= 0 ? '+' : ''}${formatRealValue(latestConverted - firstConverted, unit)}`
          : null))

  const hasRates = currentRates.goldTry !== null && currentRates.usdTry !== null

  return (
    <Card className="border-line-strong lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Net değer trendi</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              {aggregated
                ? `${view.length} ay · aylık (ay sonu) görünüm.`
                : `Son ${view.length} gün · günlük otomatik anlık görüntü.`}
            </p>
          </div>
          {changeBadge ? (
            <Badge variant={changeTry >= 0 ? 'success' : 'destructive'}>{changeBadge}</Badge>
          ) : null}
        </div>
        {/* Range toggle (roadmap Y7) */}
        <div className="mt-2 flex gap-1">
          {([
            ['90d', '90 gün'],
            ['1y', '1 yıl'],
            ['all', 'Tümü'],
          ] as [NetWorthRange, string][]).map(([r, label]) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={[
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                range === r ? 'bg-primary text-primary-foreground' : 'bg-page text-ink-muted hover:bg-black/[.03] dark:hover:bg-white/[.04]',
              ].join(' ')}
              aria-label={`Net değer trendini ${label} aralığında göster`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Unit toggle */}
        <div className="mt-2 flex gap-1">
          {(['TRY', 'GRA', 'USD'] as RealUnit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              disabled={u !== 'TRY' && !hasRates}
              className={[
                'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                unit === u
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-page text-ink-muted hover:bg-black/[.03] dark:hover:bg-white/[.04]',
                u !== 'TRY' && !hasRates ? 'cursor-not-allowed opacity-40' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={u !== 'TRY' && !hasRates ? 'Kur verisi yükleniyor...' : undefined}
              aria-label={`Net değeri ${REAL_UNIT_LABELS[u]} cinsinden göster`}
            >
              {REAL_UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <StatPill
            label="Güncel"
            value={displayValue(latest.net_worth, currentRates)}
            tone={latest.net_worth >= 0 ? 'emerald' : 'rose'}
          />
          <StatPill
            label="En yüksek"
            value={displayValue(maxSnap.net_worth, snapshotRates(maxSnap))}
            tone="emerald"
          />
          <StatPill
            label="En düşük"
            value={displayValue(minSnap.net_worth, snapshotRates(minSnap))}
            tone={minSnap.net_worth < 0 ? 'rose' : 'stone'}
          />
        </div>
        <div className="rounded-xl bg-page p-2">
          <BarChart data={barData} height={200} positiveColor="var(--success)" />
        </div>
      </CardContent>
    </Card>
  )
}

const SHOCK_PRESETS = [25_000, 50_000, 100_000] as const

export function ForwardForecast({ data }: { data: AnalysisData }) {
  const { formatAmount } = useBalancePrivacy()
  const [scenarioOpen, setScenarioOpen] = useState(false)
  // removedIds artık yalnız düzenli ödemeler için: kredilerde "bedavaya kaldır"
  // bilinçli olarak kalktı (fazla iyimserdi) — kredinin tek modu "bugün kapat".
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [payoffIds, setPayoffIds] = useState<Set<string>>(new Set())
  const [shockChoice, setShockChoice] = useState<number | 'custom' | null>(null)
  const [customShockInput, setCustomShockInput] = useState('')

  const forecastInput = useMemo(() => analysisFinanceSummaryInput(data), [data])

  const forecast = useMemo(() => buildCashFlowForecast(forecastInput, { horizonMonths: 6 }), [forecastInput])

  const shockAmount = useMemo(() => {
    const raw = shockChoice === 'custom' ? parseNumber(customShockInput) : shockChoice ?? 0
    return Number.isFinite(raw) && raw > 0 ? raw : 0
  }, [shockChoice, customShockInput])

  const scenarioMutations = useMemo<ScenarioMutation[]>(() => {
    const mutations: ScenarioMutation[] = []
    for (const id of payoffIds) mutations.push({ type: 'payoff_loan_today', loanId: id })
    for (const id of removedIds) mutations.push({ type: 'remove_payment', paymentId: id })
    if (shockAmount > 0) mutations.push({ type: 'cash_shock', amount: shockAmount })
    return mutations
  }, [payoffIds, removedIds, shockAmount])

  const startingCashDelta = useMemo(
    () => scenarioStartingCashDelta(forecastInput, scenarioMutations),
    [forecastInput, scenarioMutations],
  )

  const scenarioForecast = useMemo(() => {
    if (scenarioMutations.length === 0) return null
    return buildCashFlowForecast(applyScenario(forecastInput, scenarioMutations), {
      horizonMonths: 6,
      startingBalanceDelta: startingCashDelta,
    })
  }, [forecastInput, scenarioMutations, startingCashDelta])

  // Dayanıklılık: aktif senaryo girdisi üzerinden hesaplanır ki kredi kapatma /
  // şok ile kompoze olsun; senaryo yokken baz veriyle koşar.
  const runwayMonths = useMemo(() => {
    const input = scenarioMutations.length > 0 ? applyScenario(forecastInput, scenarioMutations) : forecastInput
    return salaryCutRunwayMonths(input, {
      startingBalanceDelta: scenarioMutations.length > 0 ? startingCashDelta : 0,
    })
  }, [forecastInput, scenarioMutations, startingCashDelta])

  const activeForBarChart = scenarioForecast ?? forecast
  const barData: BarDataPoint[] = useMemo(
    () =>
      activeForBarChart.months.map((month) => ({
        label: shortMonth(month.monthKey),
        value: month.endingBalance,
      })),
    [activeForBarChart],
  )
  const hasDeficit = activeForBarChart.firstNegative !== null

  const candidateLoans = data.loans.filter((l) => l.status === 'active' && l.remaining_installments > 0)
  const candidatePayments = data.payments.filter((p) => p.recurrence !== 'none' && p.status !== 'ödendi')

  function toggleIn(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetScenario() {
    setRemovedIds(new Set())
    setPayoffIds(new Set())
    setShockChoice(null)
    setCustomShockInput('')
  }

  const scenarioActive = scenarioMutations.length > 0
  const endingDelta = scenarioForecast ? diffTL(scenarioForecast.endingBalance, forecast.endingBalance) : null

  return (
    <Card className="border-line-strong lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>İleriye dönük nakit</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">Önümüzdeki 6 ay · bilinen gelir ve yükümlülüklere göre tahmini bakiye.</p>
          </div>
          <Badge variant={hasDeficit ? 'destructive' : 'success'}>{hasDeficit ? 'Açık riski' : 'Pozitif'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Başlangıç" value={formatAmount(activeForBarChart.startingBalance)} />
          <StatPill
            label={activeForBarChart.lowest ? `En düşük · ${shortMonth(activeForBarChart.lowest.monthKey)}` : 'En düşük'}
            value={formatAmount(activeForBarChart.lowest?.balance ?? activeForBarChart.startingBalance)}
            tone={(activeForBarChart.lowest?.balance ?? 0) < 0 ? 'rose' : 'stone'}
          />
          <StatPill
            label="6 ay sonu"
            value={formatAmount(activeForBarChart.endingBalance)}
            tone={activeForBarChart.endingBalance >= activeForBarChart.startingBalance ? 'emerald' : 'rose'}
          />
        </div>

        {/* Dayanıklılık satırı — nötr dil, sinyal rengi bilinçli yok (statementPace çizgisi) */}
        <p className="text-xs text-ink-muted">
          {scenarioActive ? 'Seçili senaryoyla gelir' : 'Gelir'} kesilse{' '}
          {runwayMonths === null
            ? 'bile 12+ ay dayanırsın'
            : runwayMonths === 0
              ? 'bu ay açığa düşersin'
              : `~${runwayMonths} ay dayanırsın`}{' '}
          (bilinen yükümlülüklere göre).
        </p>

        {activeForBarChart.firstNegative ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3">
            <p className="text-sm font-bold text-destructive">{activeForBarChart.firstNegative.monthLabel} içinde nakit açığa düşüyor</p>
            <p className="mt-0.5 text-xs text-destructive/80">
              Tahmini bakiye {formatAmount(activeForBarChart.firstNegative.balance)}. Büyük ödemeleri veya tahsilatı öne almak iyi olur.
            </p>
          </div>
        ) : null}

        {scenarioForecast && !scenarioForecast.firstNegative && forecast.firstNegative ? (
          <div className="rounded-xl border border-success/20 bg-success/8 p-3">
            <p className="text-sm font-bold text-success">Simülasyonda nakit açığı ortadan kalkıyor</p>
            <p className="mt-0.5 text-xs text-success/80">Seçili senaryo 6 ay boyunca bakiyeyi pozitif tutuyor.</p>
          </div>
        ) : null}

        <div className="rounded-xl bg-page p-2">
          <BarChart data={barData} height={200} positiveColor="var(--success)" />
        </div>

        <div className="grid gap-2 min-[560px]:grid-cols-2">
          {activeForBarChart.months.map((month) => (
            <div key={month.monthKey} className="flex items-center justify-between gap-3 rounded-xl bg-page px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{month.monthLabel}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Net{' '}
                  <span className={month.net >= 0 ? 'text-success' : 'text-destructive'}>
                    {month.net >= 0 ? '+' : ''}
                    {formatAmount(month.net)}
                  </span>
                </p>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 font-mono text-xs font-bold tabular-nums ring-1 ring-line-strong ${month.endingBalance < 0 ? 'bg-destructive/10 text-destructive' : 'bg-page text-ink'}`}
              >
                {formatAmount(month.endingBalance)}
              </span>
            </div>
          ))}
        </div>

        {/* Scenario simulator — şok çipleri kredisiz/ödemesiz durumda da anlamlı, kutu hep görünür */}
        <div className="rounded-xl border border-line-strong bg-page">
          <button
            aria-expanded={scenarioOpen}
            onClick={() => setScenarioOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-ink"
          >
            <span>Ya şöyle olsaydı?</span>
            <span className="flex items-center gap-2">
              {scenarioActive && endingDelta !== null ? (
                <Badge variant={endingDelta >= 0 ? 'success' : 'destructive'}>
                  {endingDelta >= 0 ? '+' : ''}{formatAmount(endingDelta)}
                </Badge>
              ) : null}
              <span className="text-xs text-ink-muted">{scenarioOpen ? '▲' : '▼'}</span>
            </span>
          </button>

          {scenarioOpen ? (
            <div className="space-y-3 border-t border-line-strong px-4 pb-4 pt-3">
              {candidateLoans.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Krediler — bugün kapat</p>
                  <div className="space-y-1.5">
                    {candidateLoans.map((loan) => {
                      const selected = payoffIds.has(loan.id)
                      const payoff = loanPayoffAmount(forecastInput, loan.id)
                      const breakEvenKey = selected ? payoffBreakEvenMonthKey(forecastInput, loan.id) : null
                      return (
                        <div key={loan.id}>
                          <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-black/[.03] dark:hover:bg-white/[.04]">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleIn(setPayoffIds, loan.id)}
                              className="h-4 w-4 accent-primary"
                              aria-label={`${loan.loan_name} kredisini bugün kapat`}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">{loan.loan_name}</span>
                            <span className="shrink-0 text-xs text-ink-muted">bugün kapat −{formatAmount(payoff)}</span>
                          </label>
                          {selected && breakEvenKey ? (
                            <p className="pl-9 text-xs text-ink-muted">
                              Aylık yük şimdi kalkar · bazla fark {monthYearLabel(breakEvenKey)} itibarıyla kapanır.
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {candidatePayments.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Düzenli ödemeler</p>
                  <div className="space-y-1.5">
                    {candidatePayments.map((payment) => (
                      <label key={payment.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-black/[.03] dark:hover:bg-white/[.04]">
                        <input
                          type="checkbox"
                          checked={removedIds.has(payment.id)}
                          onChange={() => toggleIn(setRemovedIds, payment.id)}
                          className="h-4 w-4 accent-primary"
                          aria-label={`${payment.title} ödemesini kaldır`}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{payment.title}</span>
                        <span className="shrink-0 text-xs text-ink-muted">{formatAmount(payment.amount)}/ay</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Tek seferlik şok gideri</p>
                <div className="flex flex-wrap gap-1.5">
                  {SHOCK_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setShockChoice((prev) => (prev === preset ? null : preset))}
                      className={[
                        'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                        shockChoice === preset
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-ink-muted ring-1 ring-line-strong hover:bg-black/[.03] dark:hover:bg-white/[.04]',
                      ].join(' ')}
                      aria-pressed={shockChoice === preset}
                      aria-label={`₺${preset.toLocaleString('tr-TR')} şok gideri uygula`}
                    >
                      ₺{preset.toLocaleString('tr-TR')}
                    </button>
                  ))}
                  <button
                    onClick={() => setShockChoice((prev) => (prev === 'custom' ? null : 'custom'))}
                    className={[
                      'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                      shockChoice === 'custom'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-ink-muted ring-1 ring-line-strong hover:bg-black/[.03] dark:hover:bg-white/[.04]',
                    ].join(' ')}
                    aria-pressed={shockChoice === 'custom'}
                  >
                    Özel
                  </button>
                </div>
                {shockChoice === 'custom' ? (
                  <MoneyInput
                    label="Şok tutarı"
                    value={customShockInput}
                    onValueChange={setCustomShockInput}
                    className="mt-2"
                  />
                ) : null}
              </div>

              {scenarioActive ? (
                <button onClick={resetScenario} className="text-xs text-ink-muted underline-offset-2 hover:underline">
                  Sıfırla
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function shortMonth(monthKey: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(new Date(`${monthKey}T00:00:00`))
}

// Başabaş ayı 6 aylık ufkun çok ötesine düşebilir — yıl olmadan yanıltıcı olur.
function monthYearLabel(monthKey: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${monthKey}T00:00:00`))
}
