import { useMemo, useState } from 'react'
import { BarChart, type BarDataPoint } from '../components/charts/BarChart'
import { CashFlowChart, type CashFlowPoint } from '../components/charts/CashFlowChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import type { NetWorthSnapshot } from '../types/database'
import { startOfMonth } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { buildCashFlowForecast } from '../utils/cashFlowForecast'
import { buildMonthlyCashFlow } from '../utils/financeSummary'
import { analysisFinanceSummaryInput, type AnalysisData } from '../utils/analysisView'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { diffTL, sumTL } from '../utils/money'
import { convertNetWorth, formatRealValue, realValueChangeBadge, type RealUnit, REAL_UNIT_LABELS } from '../utils/realValue'
import { selectNetWorthSeries, type NetWorthRange } from '../utils/netWorthSeries'
import { applyScenario, type ScenarioMutation } from '../utils/scenarioForecast'
import { StatPill } from './AnalysisPage.atoms'

export function CashFlowTrend({ data }: { data: AnalysisData }) {
  const summaryInput = useMemo(() => analysisFinanceSummaryInput(data), [data])

  const chartData: CashFlowPoint[] = useMemo(() => {
    const from = startOfMonth()
    const months = Array.from({ length: 6 }, (_, index) => new Date(from.getFullYear(), from.getMonth() - 5 + index, 1))

    return months.map((month) => {
      const cf = buildMonthlyCashFlow(summaryInput, month, { from })
      return {
        label: new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(month),
        income: cf.income,
        outflow: cf.outflow,
        net: cf.netFlow,
      }
    })
  }, [summaryInput])

  const totalNet = useMemo(() => sumTL(chartData.map((row) => row.net)), [chartData])

  return (
    <Card className="border-border/70 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>6 aylık gelir ve ödeme yükü</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Gelir, kart ödemesi ve planlı nakit çıkışlarının aylık karşılaştırması.</p>
          </div>
          <Badge variant={totalNet >= 0 ? 'success' : 'destructive'}>
            {totalNet >= 0 ? 'Pozitif' : 'Negatif'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <div className="rounded-xl bg-muted/20 p-2">
          <CashFlowChart data={chartData} height={220} />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-success" />
            Gelir
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            Nakit çıkışı
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Net
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function shortMonth(monthKey: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(new Date(`${monthKey}T00:00:00`))
}

export function NetWorthTrend({
  snapshots,
  ratesSnapshot,
}: {
  snapshots: NetWorthSnapshot[]
  ratesSnapshot: MarketRatesSnapshot | null
}) {
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
      <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
        <CardHeader className="pb-0">
          <CardTitle>Net değer trendi</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Geçmişe dönük net değer değişimi.</p>
        </CardHeader>
        <CardContent className="pt-3">
          <p className="rounded-xl bg-muted/45 p-4 text-sm text-muted-foreground">
            Trend grafiği her gün AnalysisPage açıldığında güncellenir; birkaç gün sonra burada görünür.
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
    if (unit === 'TRY') return formatCurrency(tryAmount)
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
      ? `${changeTry >= 0 ? '+' : ''}${formatCurrency(changeTry)}`
      : (realValueChangeBadge(changeTry, unit, currentRates) ??
        (latestConverted !== null && firstConverted !== null
          ? `${latestConverted - firstConverted >= 0 ? '+' : ''}${formatRealValue(latestConverted - firstConverted, unit)}`
          : null))

  const hasRates = currentRates.goldTry !== null && currentRates.usdTry !== null

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Net değer trendi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
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
                range === r ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
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
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted',
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
        <div className="rounded-xl bg-muted/20 p-2">
          <BarChart data={barData} height={200} positiveColor="var(--success)" />
        </div>
      </CardContent>
    </Card>
  )
}

export function ForwardForecast({ data }: { data: AnalysisData }) {
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  const forecastInput = useMemo(() => analysisFinanceSummaryInput(data), [data])

  const forecast = useMemo(() => buildCashFlowForecast(forecastInput, { horizonMonths: 6 }), [forecastInput])

  const scenarioMutations = useMemo<ScenarioMutation[]>(() => {
    if (removedIds.size === 0) return []
    const mutations: ScenarioMutation[] = []
    for (const id of removedIds) {
      if (data.loans.some((l) => l.id === id)) mutations.push({ type: 'remove_loan', loanId: id })
      else mutations.push({ type: 'remove_payment', paymentId: id })
    }
    return mutations
  }, [removedIds, data.loans])

  const scenarioForecast = useMemo(() => {
    if (scenarioMutations.length === 0) return null
    return buildCashFlowForecast(applyScenario(forecastInput, scenarioMutations), { horizonMonths: 6 })
  }, [forecastInput, scenarioMutations])

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

  function toggleId(id: string) {
    setRemovedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const endingDelta = scenarioForecast ? diffTL(scenarioForecast.endingBalance, forecast.endingBalance) : null

  return (
    <Card className="border-border/70 shadow-[var(--shadow-card)] lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>İleriye dönük nakit</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Önümüzdeki 6 ay · bilinen gelir ve yükümlülüklere göre tahmini bakiye.</p>
          </div>
          <Badge variant={hasDeficit ? 'destructive' : 'success'}>{hasDeficit ? 'Açık riski' : 'Pozitif'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <StatPill label="Başlangıç" value={formatCurrency(activeForBarChart.startingBalance)} />
          <StatPill
            label={activeForBarChart.lowest ? `En düşük · ${shortMonth(activeForBarChart.lowest.monthKey)}` : 'En düşük'}
            value={formatCurrency(activeForBarChart.lowest?.balance ?? activeForBarChart.startingBalance)}
            tone={(activeForBarChart.lowest?.balance ?? 0) < 0 ? 'rose' : 'stone'}
          />
          <StatPill
            label="6 ay sonu"
            value={formatCurrency(activeForBarChart.endingBalance)}
            tone={activeForBarChart.endingBalance >= activeForBarChart.startingBalance ? 'emerald' : 'rose'}
          />
        </div>

        {activeForBarChart.firstNegative ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3">
            <p className="text-sm font-bold text-destructive">{activeForBarChart.firstNegative.monthLabel} içinde nakit açığa düşüyor</p>
            <p className="mt-0.5 text-xs text-destructive/80">
              Tahmini bakiye {formatCurrency(activeForBarChart.firstNegative.balance)}. Büyük ödemeleri veya tahsilatı öne almak iyi olur.
            </p>
          </div>
        ) : null}

        {scenarioForecast && !scenarioForecast.firstNegative && forecast.firstNegative ? (
          <div className="rounded-xl border border-success/20 bg-success/8 p-3">
            <p className="text-sm font-bold text-success">Simülasyonda nakit açığı ortadan kalkıyor</p>
            <p className="mt-0.5 text-xs text-success/80">Seçili yükümlülükleri kaldırmak 6 ay boyunca pozitif bakiyeyi koruyor.</p>
          </div>
        ) : null}

        <div className="rounded-xl bg-muted/20 p-2">
          <BarChart data={barData} height={200} positiveColor="var(--success)" />
        </div>

        <div className="grid gap-2 min-[560px]:grid-cols-2">
          {activeForBarChart.months.map((month) => (
            <div key={month.monthKey} className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{month.monthLabel}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Net{' '}
                  <span className={month.net >= 0 ? 'text-success' : 'text-destructive'}>
                    {month.net >= 0 ? '+' : ''}
                    {formatCurrency(month.net)}
                  </span>
                </p>
              </div>
              <span
                className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 font-mono text-xs font-bold tabular-nums ring-1 ring-border/60 ${month.endingBalance < 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground'}`}
              >
                {formatCurrency(month.endingBalance)}
              </span>
            </div>
          ))}
        </div>

        {/* Scenario simulator */}
        {(candidateLoans.length > 0 || candidatePayments.length > 0) ? (
          <div className="rounded-xl border border-border/50 bg-muted/20">
            <button
              aria-expanded={scenarioOpen}
              onClick={() => setScenarioOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground"
            >
              <span>Ya şöyle olsaydı?</span>
              <span className="flex items-center gap-2">
                {removedIds.size > 0 && endingDelta !== null ? (
                  <Badge variant={endingDelta >= 0 ? 'success' : 'destructive'}>
                    {endingDelta >= 0 ? '+' : ''}{formatCurrency(endingDelta)}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">{scenarioOpen ? '▲' : '▼'}</span>
              </span>
            </button>

            {scenarioOpen ? (
              <div className="space-y-3 border-t border-border/40 px-4 pb-4 pt-3">
                {candidateLoans.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Krediler</p>
                    <div className="space-y-1.5">
                      {candidateLoans.map((loan) => (
                        <label key={loan.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                          <input
                            type="checkbox"
                            checked={removedIds.has(loan.id)}
                            onChange={() => toggleId(loan.id)}
                            className="h-4 w-4 accent-primary"
                            aria-label={`${loan.loan_name} kredisini kaldır`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{loan.loan_name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(loan.monthly_payment)}/ay</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {candidatePayments.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Düzenli ödemeler</p>
                    <div className="space-y-1.5">
                      {candidatePayments.map((payment) => (
                        <label key={payment.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                          <input
                            type="checkbox"
                            checked={removedIds.has(payment.id)}
                            onChange={() => toggleId(payment.id)}
                            className="h-4 w-4 accent-primary"
                            aria-label={`${payment.title} ödemesini kaldır`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{payment.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatCurrency(payment.amount)}/ay</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {removedIds.size > 0 ? (
                  <button
                    onClick={() => setRemovedIds(new Set())}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Sıfırla
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
