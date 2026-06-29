import { Flame, HandCoins, PieChart, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BarChart, type BarDataPoint } from '../components/charts/BarChart'
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import type { NetWorthSnapshot } from '../types/database'
import { formatDate, isDateInMonth } from '../utils/date'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { buildFinancialPosition, getCurrentSalary, sum } from '../utils/financeSummary'
import { buildCategoryInsights, type AnalysisData } from '../utils/analysisView'
import { activeExpense as activeCardExpense } from '../utils/budgetAlerts'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { computeFire, estimateMonthlySavingsFromNetWorth } from '../utils/fire'
import { buildInflationShield } from '../utils/inflationShield'
import { diffTL, roundTL, sumTL } from '../utils/money'
import { computeZakat } from '../utils/zakat'
import { StatPill } from './AnalysisPage.atoms'

const CATEGORY_PALETTE = [
  'var(--primary)', 'var(--success)', 'var(--warning)', 'var(--destructive)',
  'var(--info)', '#a78bfa', '#fb923c', '#38bdf8',
]

export function FireCalculator({ data, snapshots }: { data: AnalysisData; snapshots: NetWorthSnapshot[] }) {
  const position = useMemo(
    () =>
      buildFinancialPosition({
        assets: data.assets,
        cards: data.cards,
        loans: data.loans,
        loanInstallments: data.loanInstallments,
        debts: data.debts,
        payments: data.payments,
        salaryHistory: data.salaryHistory,
        cardInstallments: data.cardInstallments,
      }),
    [data.assets, data.cards, data.loans, data.loanInstallments, data.debts, data.payments, data.salaryHistory, data.cardInstallments],
  )

  // Living-cost proxy: average monthly card spending + steady monthly bills.
  const defaultExpenses = useMemo(() => {
    const active = data.cardExpenses.filter(activeCardExpense)
    const monthCount = Math.max(1, new Set(active.map((expense) => expense.spent_at.slice(0, 7))).size)
    const avgCard = roundTL(sum(active, (expense) => expense.amount) / monthCount)
    const monthlyRecurring = sum(data.payments.filter((payment) => payment.recurrence === 'monthly'), (payment) => payment.amount)
    return sumTL([avgCard, monthlyRecurring])
  }, [data.cardExpenses, data.payments])

  const salary = getCurrentSalary(data.salaryHistory)?.amount ?? 0
  const snapshotSavings = useMemo(() => estimateMonthlySavingsFromNetWorth(snapshots), [snapshots])
  const defaultSavings = snapshotSavings ?? diffTL(salary, defaultExpenses)
  const savingsSource = snapshotSavings !== null ? 'net değer trendi' : 'maaş − gider'

  const [realReturn, setRealReturn] = useState(4)
  const [withdrawal, setWithdrawal] = useState(4)
  // null override = follow the data-derived default (survives async data load).
  const [expensesOverride, setExpensesOverride] = useState<number | null>(null)
  const [savingsOverride, setSavingsOverride] = useState<number | null>(null)

  const monthlyExpenses = expensesOverride ?? defaultExpenses
  const monthlySavings = savingsOverride ?? defaultSavings

  const result = useMemo(
    () =>
      computeFire({
        currentNetWorth: position.netWorth,
        monthlyExpenses,
        monthlySavings,
        annualRealReturnPct: realReturn,
        withdrawalRatePct: withdrawal,
      }),
    [position.netWorth, monthlyExpenses, monthlySavings, realReturn, withdrawal],
  )

  const chartData: BarDataPoint[] = useMemo(() => {
    const points = result.projection
    const stride = Math.max(1, Math.ceil(points.length / 10))
    return points
      .filter((_, index) => index % stride === 0 || index === points.length - 1)
      .map((point) => ({
        label: point.month === 0 ? 'Bugün' : `${Math.round(point.month / 12)}y`,
        value: point.netWorth,
        color: result.fireNumber > 0 && point.netWorth >= result.fireNumber ? 'var(--success)' : 'var(--primary)',
      }))
  }, [result.projection, result.fireNumber])

  if (position.netWorth <= 0 && defaultExpenses <= 0) return null

  const headline = result.alreadyReached
    ? 'Finansal bağımsızlığa ulaştın 🎉'
    : result.monthsToFire === null
      ? 'Bu varsayımlarla hedefe ulaşılamıyor — birikimi artır.'
      : `Tahmini hedef: ${result.targetDate ? formatDate(result.targetDate) : '—'}`

  return (
    <Card className="border-border/70 lg:col-span-12">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Finansal bağımsızlık (FIRE)</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Bu birikim hızıyla pasif gelirin giderini ne zaman karşılar.</p>
          </div>
          <Flame size={18} className="text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-4">
          <StatPill label="Hedef servet" value={formatCurrency(result.fireNumber)} />
          <StatPill label="İlerleme" value={`%${Math.round(result.progressPct)}`} tone={result.progressPct >= 100 ? 'emerald' : 'stone'} />
          <StatPill
            label="Kalan süre"
            value={result.yearsToFire === null ? '—' : result.yearsToFire < 1 ? '<1 yıl' : `${result.yearsToFire.toFixed(1)} yıl`}
            tone={result.alreadyReached ? 'emerald' : result.monthsToFire === null ? 'rose' : 'stone'}
          />
          <StatPill label="Aylık birikim" value={formatCurrency(monthlySavings)} tone={monthlySavings >= 0 ? 'emerald' : 'rose'} />
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{headline}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {formatCurrency(position.netWorth)} / {formatCurrency(result.fireNumber)}
            </span>
          </div>
          <Progress value={result.progressPct} autoColor size="default" />
        </div>

        <div className="grid gap-3 min-[720px]:grid-cols-2">
          <label className="rounded-xl bg-muted/40 p-3">
            <span className="finance-label">Aylık gider</span>
            <input
              type="number"
              min="0"
              step="500"
              value={monthlyExpenses}
              onChange={(event) => setExpensesOverride(parseNumber(event.target.value))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <span className="finance-label">
              Aylık birikim <span className="font-normal normal-case text-muted-foreground">({savingsSource})</span>
            </span>
            <input
              type="number"
              step="500"
              value={monthlySavings}
              onChange={(event) => setSavingsOverride(parseNumber(event.target.value))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="finance-label">Yıllık reel getiri</span>
              <span className="text-sm font-bold tabular-nums text-foreground">%{realReturn}</span>
            </div>
            <input
              type="range"
              min="0"
              max="15"
              step="0.5"
              value={realReturn}
              onChange={(event) => setRealReturn(Number(event.target.value))}
              aria-label="Yıllık reel getiri yüzdesi"
              className="mt-2 w-full accent-primary"
            />
          </label>
          <label className="rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="finance-label">Güvenli çekim oranı</span>
              <span className="text-sm font-bold tabular-nums text-foreground">%{withdrawal} · {(100 / withdrawal).toFixed(0)}×</span>
            </div>
            <input
              type="range"
              min="2.5"
              max="6"
              step="0.5"
              value={withdrawal}
              onChange={(event) => setWithdrawal(Number(event.target.value))}
              aria-label="Güvenli çekim oranı yüzdesi"
              className="mt-2 w-full accent-primary"
            />
          </label>
        </div>

        <div className="rounded-xl bg-muted/20 p-2">
          <BarChart data={chartData} height={200} />
        </div>
      </CardContent>
    </Card>
  )
}

const SHIELD_COLORS: Record<string, string> = {
  Nakit: 'var(--warning)',
  Altın: '#f59e0b',
  Hisse: 'var(--primary)',
  Fon: 'var(--info)',
  BES: '#a78bfa',
  Araç: '#94a3b8',
  Diğer: '#64748b',
}

export function InflationShieldPanel({ data }: { data: AnalysisData }) {
  const shield = useMemo(() => buildInflationShield(data.assets, data.cards), [data.assets, data.cards])
  if (shield.totalValue <= 0) return null

  const protectedPct = Math.round(shield.protectedRatio * 100)
  const meltingPct = 100 - protectedPct
  const donutData: DonutSlice[] = shield.categories.map((category) => ({
    name: category.category,
    value: category.value,
    color: SHIELD_COLORS[category.category] ?? (category.bucket === 'melting' ? 'var(--warning)' : 'var(--primary)'),
  }))
  const headline =
    protectedPct >= 60
      ? 'Servetinin büyük kısmı enflasyona karşı reel varlıkta.'
      : protectedPct >= 35
        ? 'Reel varlık payın orta seviyede; TL nakit oranını izlemekte fayda var.'
        : 'Servetinin çoğu eriyen TL nakitte — enflasyon riski yüksek.'

  return (
    <Card className="border-border/70 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Enflasyon kalkanı</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Servetinin ne kadarı reel varlıkta, ne kadarı eriyen TL nakitte.</p>
          </div>
          <ShieldCheck size={18} className="text-emerald-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-2">
          <StatPill label="Reel / korumalı" value={`%${protectedPct}`} tone={protectedPct >= 60 ? 'emerald' : 'stone'} />
          <StatPill label="Eriyen TL nakit" value={`%${meltingPct}`} tone={meltingPct > 65 ? 'rose' : 'stone'} />
        </div>
        <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">{headline}</div>
        <DonutChart data={donutData} size={180} innerRadius={50} totalLabel="Varlık" />
      </CardContent>
    </Card>
  )
}

function ZakatToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-xs ring-1 ring-border/60">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-3.5 accent-primary" />
      <span className="text-muted-foreground">{label}</span>
    </label>
  )
}

export function ZakatPanel({ data, ratesSnapshot }: { data: AnalysisData; ratesSnapshot: MarketRatesSnapshot | null }) {
  const [includeReceivables, setIncludeReceivables] = useState(true)
  const [includeBes, setIncludeBes] = useState(false)
  const [deductDebts, setDeductDebts] = useState(true)

  const zakat = useMemo(
    () =>
      computeZakat(
        {
          assets: data.assets,
          cards: data.cards,
          loans: data.loans,
          loanInstallments: data.loanInstallments,
          debts: data.debts,
          payments: data.payments,
          salaryHistory: data.salaryHistory,
          cardInstallments: data.cardInstallments,
        },
        ratesSnapshot,
        { includeReceivables, includeBes, deductDebts },
      ),
    [data, ratesSnapshot, includeReceivables, includeBes, deductDebts],
  )

  if (zakat.zakatableAssets <= 0) return null

  return (
    <Card className="border-border/70 lg:col-span-7">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Zekât hesaplayıcı</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Diyanet ölçüsü: 80,18 gr altın nisabı, %2,5 oran, borçlar düşülür.</p>
          </div>
          <HandCoins size={18} className="text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        <div className="grid gap-2 min-[560px]:grid-cols-3">
          <StatPill label="Zekâta tabi net servet" value={formatCurrency(zakat.netWealth)} />
          <StatPill label="Nisab (80,18 gr altın)" value={zakat.nisabTry === null ? '—' : formatCurrency(zakat.nisabTry)} />
          <StatPill
            label="Hesaplanan zekât"
            value={formatCurrency(zakat.zakatDue)}
            tone={zakat.meetsNisab ? 'emerald' : 'stone'}
          />
        </div>

        <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          {zakat.nisabTry === null
            ? 'Gram altın fiyatı yüklenemediği için nisab hesaplanamadı.'
            : zakat.meetsNisab
              ? 'Net servetin nisabı aştı; %2,5 zekât hesaplandı.'
              : 'Net servetin nisabın altında — zekât gerekmiyor.'}
        </div>

        <div className="rounded-xl bg-muted/40 p-3">
          <p className="finance-label mb-2">Hesap kalemleri</p>
          <div className="grid gap-1.5">
            {zakat.components.map((component) => (
              <div key={component.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{component.sign < 0 ? '− ' : '+ '}{component.label}</span>
                <span className={`font-mono tabular-nums ${component.sign < 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {component.sign < 0 ? '-' : ''}{formatCurrency(component.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <ZakatToggle checked={includeReceivables} onChange={setIncludeReceivables} label="Alacakları dahil et" />
          <ZakatToggle checked={deductDebts} onChange={setDeductDebts} label="Borçları düş" />
          <ZakatToggle checked={includeBes} onChange={setIncludeBes} label="BES'i dahil et" />
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Bu bir tahmindir; uygulama bir mal üzerinden bir yıl (hawl) geçip geçmediğini takip edemez ve hisse/fon için
          basitleştirilmiş piyasa değeri kullanır. Kesin hüküm için bir yetkiliye danışın.
        </p>
      </CardContent>
    </Card>
  )
}

export function CategorySpendingChart({ data }: { data: AnalysisData }) {
  const monthlyExpenses = useMemo(
    () => data.cardExpenses.filter((expense) => activeCardExpense(expense) && isDateInMonth(expense.spent_at)),
    [data.cardExpenses],
  )
  const insights = useMemo(() => buildCategoryInsights(data), [data])
  const categoryTotals = Array.from(
    monthlyExpenses.reduce((map, expense) => {
      const category = expense.category || 'Diğer'
      map.set(category, sumTL([map.get(category), expense.amount]))
      return map
    }, new Map<string, number>()),
    ([category, amount]) => ({ category, amount }),
  ).sort((a, b) => b.amount - a.amount)

  const donutData: DonutSlice[] = categoryTotals.slice(0, 7).map((item, i) => ({
    name:  item.category,
    value: item.amount,
    color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
  }))

  return (
    <Card className="border-border/70 lg:col-span-5">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Kategori harcaması</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Bu ay kart harcamalarının dağılımı.</p>
          </div>
          <PieChart size={18} className="text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        {donutData.length === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bu ay kategorili kart harcaması yok.</p>
        ) : (
          <DonutChart data={donutData} size={180} innerRadius={50} totalLabel="Bu ay" />
        )}
        {insights.length > 0 ? (
          <div className="rounded-xl bg-muted/40 p-3">
            <p className="finance-label mb-2">Kategori içgörüleri</p>
            <div className="grid gap-2">
              {insights.map((insight) => (
                <div key={`${insight.category}-${insight.title}`} className="flex min-w-0 items-start justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border/60">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{insight.category}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{insight.title} · {insight.description}</p>
                  </div>
                  <Badge variant={insight.tone === 'rose' ? 'destructive' : insight.tone === 'amber' ? 'warning' : 'success'}>
                    {formatCurrency(insight.amount)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
