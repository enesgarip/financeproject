import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  Lightbulb,
  ListChecks,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import type { CardExpense } from '../../types/database'
import type { DashboardUpcomingItem } from '../../utils/dashboardUpcoming'
import { daysUntil } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { detectSpendingAnomalies } from '../../utils/spendingAnomalies'
import type { CashFlowSummary } from '../../utils/financeSummary'
import type { FocusAction, SmartInsight } from './DashboardPanels'

type UpcomingItem = DashboardUpcomingItem

export function FocusActionPanel({ actions, cashFlow }: { actions: FocusAction[]; cashFlow: CashFlowSummary }) {
  const [showAll, setShowAll] = useState(false)
  const primaryAction = actions[0]
  const cashIsPositive = cashFlow.projectedCash >= 0
  const statusLabel = primaryAction.priority <= 20 ? 'Aksiyon gerekli' : 'Takip temiz'
  const visibleActions = showAll ? actions : actions.slice(0, 4)
  const hiddenCount = Math.max(0, actions.length - 4)

  return (
    <Card className="border-0 bg-card/95 py-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardContent className="p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:items-stretch">
          <div className="flex min-w-0 flex-col justify-between rounded-lg border border-border/75 bg-surface-muted p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-primary">Bugünün odağı</p>
                <h2 className="mt-2 text-2xl font-black leading-tight text-foreground">{statusLabel}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  En önemli finans aksiyonlarını vade, bakiye ve limit durumuna göre sıraladım.
                </p>
              </div>
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                <ListChecks size={21} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-card/80 px-3 py-2 ring-1 ring-border/70">
                <p className="font-bold uppercase text-muted-foreground">Ay sonu</p>
                <p className={`finance-value mt-1 truncate text-sm font-extrabold ${cashIsPositive ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(cashFlow.projectedCash)}
                </p>
              </div>
              <div className="rounded-lg bg-card/80 px-3 py-2 ring-1 ring-border/70">
                <p className="font-bold uppercase text-muted-foreground">Sıradaki</p>
                <p className="mt-1 truncate text-sm font-extrabold text-foreground">{primaryAction.cta}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="grid gap-2 min-[720px]:grid-cols-2">
              {visibleActions.map((action) => (
                <FocusActionCard key={action.id} action={action} />
              ))}
            </div>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Aksiyonları daralt' : `Tüm aksiyonları göster (${actions.length})`}
              </button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FocusActionCard({ action }: { action: FocusAction }) {
  const Icon = {
    alert: AlertTriangle,
    calendar: CalendarDays,
    card: CreditCard,
    check: CheckCircle2,
    health: ShieldCheck,
    loan: Landmark,
  }[action.icon]
  const toneClass = {
    emerald: 'border-success/20 bg-card text-foreground ring-success/15 hover:border-success/35',
    amber: 'border-warning/25 bg-card text-foreground ring-warning/15 hover:border-warning/40',
    rose: 'border-destructive/20 bg-card text-foreground ring-destructive/15 hover:border-destructive/35',
    indigo: 'border-info/20 bg-card text-foreground ring-info/15 hover:border-info/35',
    stone: 'border-border bg-card text-foreground ring-border/70 hover:border-muted-foreground/35',
  }[action.tone]
  const iconClass = {
    emerald: 'bg-success/10 text-success',
    amber: 'bg-warning/12 text-warning',
    rose: 'bg-destructive/10 text-destructive',
    indigo: 'bg-info/10 text-info',
    stone: 'bg-muted text-muted-foreground',
  }[action.tone]

  return (
    <Link
      to={action.to}
      className={`group flex min-w-0 flex-col justify-between rounded-lg border p-3 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${toneClass}`}
    >
      <div className="flex items-start gap-3">
        <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${iconClass}`}>
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold leading-snug">{action.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{action.description}</p>
        </div>
      </div>
      <span className="mt-3 inline-flex items-center text-xs font-black uppercase tracking-normal text-muted-foreground group-hover:text-foreground">
        {action.cta}
        <ArrowUpRight className="ml-1 size-3.5" />
      </span>
    </Link>
  )
}

export function SpendingRadarPanel({ expenses }: { expenses: CardExpense[] }) {
  const { anomalies, recurring } = useMemo(() => detectSpendingAnomalies(expenses), [expenses])

  const hasContent = anomalies.length > 0 || recurring.length > 0
  if (!hasContent) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Harcama radari</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Ortalamayı aşan kategoriler ve tekrar eden giderler.</p>
          </div>
          <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        {anomalies.slice(0, 3).map((anomaly) => (
          <div key={anomaly.category} className="rounded-lg bg-amber-50/70 px-3 py-2 ring-1 ring-amber-200/60 dark:bg-amber-950/20 dark:ring-amber-900/40">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-bold text-amber-900 dark:text-amber-100">{anomaly.category}</p>
              <span className="shrink-0 rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                +{Math.round((anomaly.ratio - 1) * 100)}%
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/70">
              Bu ay {formatCurrency(anomaly.currentMonth)} · ort. {formatCurrency(anomaly.threeMonthAvg)}
            </p>
          </div>
        ))}
        {recurring.slice(0, 3).map((item) => (
          <div key={item.description} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{item.description}</p>
              <p className="text-[11px] text-muted-foreground">{item.monthCount} ay tekrar · {item.category}</p>
            </div>
            <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">{formatCurrency(item.amount)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function SmartInsightsPanel({ insights }: { insights: SmartInsight[] }) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100',
    amber: 'border-amber-200 bg-amber-50/75 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100',
    rose: 'border-rose-200 bg-rose-50/75 text-rose-950 dark:border-rose-900 dark:bg-rose-950/25 dark:text-rose-100',
    stone: 'border-border bg-card text-foreground',
  }
  const iconClass = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
    stone: 'bg-muted text-muted-foreground',
  }

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Akıllı uyarılar</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Bu ay karar vermeyi hızlandıran kısa finans sinyalleri.</p>
          </div>
          <Lightbulb className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-2 min-[560px]:grid-cols-2">
        {insights.map((insight) => {
          const Icon = insight.tone === 'rose' ? AlertTriangle : insight.tone === 'emerald' ? ShieldCheck : Lightbulb

          return (
            <article key={insight.title} className={`rounded-lg border p-3 ${toneClass[insight.tone]}`}>
              <div className="flex items-start gap-3">
                <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconClass[insight.tone]}`}>
                  <Icon size={17} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold leading-snug">{insight.title}</h3>
                  <p className="mt-1 text-xs leading-5 opacity-75">{insight.description}</p>
                </div>
              </div>
            </article>
          )
        })}
      </CardContent>
    </Card>
  )
}

function upcomingDayLabel(sortTime: number) {
  const remaining = daysUntil(new Date(sortTime))
  if (remaining === null) return 'Tarih yok'
  if (remaining < 0) return `${Math.abs(remaining)} gün geçti`
  if (remaining === 0) return 'Bugün'
  if (remaining === 1) return 'Yarın'
  return `${remaining} gün kaldı`
}

export function UpcomingAlertPanel({ items }: { items: UpcomingItem[] }) {
  const [showAll, setShowAll] = useState(false)

  if (items.length === 0) return null

  const urgentCount = items.filter((item) => {
    const remaining = daysUntil(new Date(item.sortTime))
    return remaining !== null && remaining <= 7
  }).length
  const visibleItems = showAll ? items : items.slice(0, 3)
  const hiddenCount = Math.max(0, items.length - 3)

  return (
    <Card className="min-w-0 border-amber-200 bg-amber-50/70 py-0 shadow-sm ring-1 ring-amber-200/80 dark:border-amber-900 dark:bg-amber-950/20 dark:ring-amber-900/70 lg:col-span-12">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold uppercase text-amber-800 dark:text-amber-200">Ödeme alarmı</p>
              <Badge variant={urgentCount > 0 ? 'destructive' : 'secondary'}>{urgentCount > 0 ? `${urgentCount} yakın vade` : `${items.length} kayıt`}</Badge>
            </div>
            <p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">
              Yaklaşan kart, kredi, fatura ve kişisel borç vadelerini kaçırmamak için öne aldım.
            </p>
          </div>
          <div className="min-w-0 flex-1 min-[760px]:max-w-xl">
            <div className={`grid gap-2 ${showAll ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
              {visibleItems.map((item) => (
                <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-card/80 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.date} · {upcomingDayLabel(item.sortTime)}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold tabular-nums text-amber-900 dark:bg-amber-900/45 dark:text-amber-100">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-card/70 px-3 py-2 text-xs font-bold text-amber-900 shadow-sm transition hover:bg-card dark:border-amber-900/70 dark:text-amber-100"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Daralt' : `Tümünü göster (${items.length})`}
              </button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
