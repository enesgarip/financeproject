import { HandCoins, PieChart, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { isDateInMonth } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'

import { buildCategoryInsights, type AnalysisData } from '../utils/analysisView'
import { activeExpense as activeCardExpense } from '../utils/budgetAlerts'
import { type MarketRatesSnapshot } from '../utils/marketRates'
import { buildInflationShield } from '../utils/inflationShield'
import { sumTL } from '../utils/money'
import { computeZakat } from '../utils/zakat'
import { StatPill } from './AnalysisPage.atoms'

const CATEGORY_PALETTE = [
  'var(--primary)', 'var(--success)', 'var(--warning)', 'var(--destructive)',
  'var(--info)', '#a78bfa', '#fb923c', '#38bdf8',
]

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
  const { formatAmount } = useBalancePrivacy()
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
          <StatPill label="Zekâta tabi net servet" value={formatAmount(zakat.netWealth)} />
          <StatPill label="Nisab (80,18 gr altın)" value={zakat.nisabTry === null ? '—' : formatAmount(zakat.nisabTry)} />
          <StatPill
            label="Hesaplanan zekât"
            value={formatAmount(zakat.zakatDue)}
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
                  {component.sign < 0 ? '-' : ''}{formatAmount(component.amount)}
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
  const { formatAmount } = useBalancePrivacy()
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
                    {formatAmount(insight.amount)}
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
