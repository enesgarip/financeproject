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
  Search,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../EmptyState'
import { dashboardHelp } from './dashboardPanelUtils'
import { CashFlowChart, type CashFlowPoint } from '../charts/CashFlowChart'
import { DonutChart, type DonutSlice } from '../charts/DonutChart'
import { AmountDisplay, FinancePanel, MetricCard, MiniStat, PageHero, ProgressStrip, SectionHeader, StatusBadge } from '../finance/FinanceUI'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { Input } from '../ui/input'
import { Progress } from '../ui/progress'
import type { Card as FinanceCard, CardExpense, TransactionHistory, TransactionHistoryType } from '../../types/database'
import type { DashboardMonthlyLoadSummary, DashboardUpcomingItem } from '../../utils/dashboardUpcoming'
import { daysUntil, formatDate, nextMonthlyDate } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { roundTL } from '../../utils/money'
import { detectSpendingAnomalies } from '../../utils/spendingAnomalies'
import {
  cardMonthlyPaymentAmount,
  getSalaryTrend,
  sum,
  type CashFlowSummary,
  type CreditLimitGroup,
  type FinancialHealthSummary,
  type GoalProgressSummary,
} from '../../utils/financeSummary'

type UpcomingItem = DashboardUpcomingItem

const UPCOMING_DAYS = 30

const historyFilters: Array<{ label: string; value: TransactionHistoryType | 'all' }> = [
  { label: 'Tümü', value: 'all' },
  { label: 'Ödeme', value: 'payment' },
  { label: 'Transfer', value: 'transfer' },
  { label: 'Kredi', value: 'loan' },
  { label: 'Borç', value: 'debt' },
  { label: 'Kart', value: 'card' },
]

export type SmartInsight = {
  title: string
  description: string
  tone: 'emerald' | 'amber' | 'rose' | 'stone'
}

export type FocusAction = {
  id: string
  title: string
  description: string
  to: string
  cta: string
  tone: 'emerald' | 'amber' | 'rose' | 'indigo' | 'stone'
  icon: 'alert' | 'calendar' | 'card' | 'check' | 'health' | 'loan'
  priority: number
}

export function DataHealthBadge({ errors, warnings, total }: { errors: number; warnings: number; total: number }) {
  if (total === 0) {
    return (
      <Link
        to="/veri-sagligi"
        className="flex items-center gap-2 rounded-xl bg-emerald-500/8 px-4 py-2.5 text-sm font-medium text-emerald-600 ring-1 ring-emerald-500/20 transition hover:bg-emerald-500/15 dark:text-emerald-400"
      >
        <ShieldCheck size={16} className="shrink-0" />
        <span>Veri sağlığı temiz</span>
      </Link>
    )
  }

  const tone = errors > 0 ? 'destructive' : 'warning'
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} hata`)
  if (warnings > 0) parts.push(`${warnings} uyarı`)

  return (
    <Link
      to="/veri-sagligi"
      className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 transition hover:opacity-90 ${
        tone === 'destructive'
          ? 'bg-destructive/8 text-destructive ring-destructive/20'
          : 'bg-warning/8 text-warning ring-warning/20'
      }`}
    >
      <ShieldAlert size={16} className="shrink-0" />
      <span>Veri sağlığı: {parts.join(' · ')}</span>
      <span className="ml-auto text-xs opacity-70">Kontrol et →</span>
    </Link>
  )
}

export function DashboardHero({
  displayName,
  netWorth,
  totalAssets,
  totalDebts,
  totalReceivables,
  cashFlow,
  health,
}: {
  displayName: string
  netWorth: number
  totalAssets: number
  totalDebts: number
  totalReceivables: number
  cashFlow: CashFlowSummary
  health: FinancialHealthSummary
}) {
  const netWorthTone = netWorth >= 0 ? 'good' : 'danger'
  const debtPressure = totalAssets > 0 ? Math.min(100, (totalDebts / totalAssets) * 100) : totalDebts > 0 ? 100 : 0
  const projectedTone = cashFlow.projectedCash >= 0 ? 'good' : 'danger'

  return (
    <PageHero
      label="Finansal durum"
      title={displayName ? `Merhaba, ${displayName}` : 'Bugünkü finans tablon'}
      amount={formatCurrency(netWorth)}
      tone={netWorthTone}
      description={`${cashFlow.monthLabel} için net varlık, borç baskısı ve nakit projeksiyonu tek bakışta.`}
      action={<StatusBadge tone={health.tone === 'emerald' ? 'good' : health.tone === 'amber' ? 'warning' : 'danger'}>{health.label}</StatusBadge>}
    >
      <div className="grid gap-2 min-[520px]:grid-cols-4">
        <MiniStat label="Toplam varlık" value={formatCurrency(totalAssets)} tone="good" />
        <MiniStat label="Toplam borç" value={formatCurrency(totalDebts)} tone={totalDebts > 0 ? 'danger' : 'good'} />
        <MiniStat label="Ay sonu nakit" value={formatCurrency(cashFlow.projectedCash)} tone={projectedTone} />
        <MiniStat label="Bekleyen tahsilat" value={formatCurrency(totalReceivables)} tone={totalReceivables > 0 ? 'info' : 'neutral'} />
      </div>
      <ProgressStrip
        label="Borç / varlık baskısı"
        value={debtPressure}
        tone={debtPressure >= 75 ? 'danger' : debtPressure >= 45 ? 'warning' : 'good'}
        detail={health.description}
      />
    </PageHero>
  )
}

export function MonthlyPaymentLoadPanel({
  cashFlow,
  nextMonthLoad,
  upcomingTotal,
  upcomingCount,
}: {
  cashFlow: CashFlowSummary
  nextMonthLoad: DashboardMonthlyLoadSummary
  upcomingTotal: number
  upcomingCount: number
}) {
  const loadRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : cashFlow.outflow > 0 ? 100 : 0
  const tone = loadRate >= 90 ? 'danger' : loadRate >= 65 ? 'warning' : 'good'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Bu ay ödeme yükü"
        description="Kart, kredi, fatura ve kişisel borç baskısı."
        action={<StatusBadge tone={tone}>{upcomingCount > 0 ? `${upcomingCount} vade` : 'Takvim temiz'}</StatusBadge>}
      />
      <div className="mt-5">
        <AmountDisplay label={cashFlow.monthLabel} value={formatCurrency(cashFlow.outflow)} tone={tone} size="lg" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Yaklaşan toplam" value={upcomingCount > 0 ? formatCurrency(upcomingTotal) : 'Yok'} tone={upcomingCount > 0 ? 'warning' : 'good'} />
        <MiniStat label="Gelecek ay" value={formatCurrency(nextMonthLoad.total)} tone={nextMonthLoad.total > cashFlow.outflow ? 'warning' : 'neutral'} />
      </div>
      <div className="mt-5">
        <ProgressStrip label="Gelire göre çıkış" value={loadRate} tone={tone} />
      </div>
    </FinancePanel>
  )
}

export function CreditCardSnapshotPanel({
  cards,
  totalDebt,
  statementDebt,
  totalLimit,
  usageRate,
}: {
  cards: FinanceCard[]
  totalDebt: number
  statementDebt: number
  totalLimit: number
  usageRate: number
}) {
  const creditCards = cards.filter((card) => card.card_type === 'kredi_karti')
  const visibleCards = [...creditCards].sort((left, right) => right.debt_amount - left.debt_amount).slice(0, 3)
  const availableLimit = Math.max(0, totalLimit - totalDebt)
  const dueSoonCount = creditCards.filter((card) => {
    const remaining = daysUntil(nextMonthlyDate(card.due_day))
    return cardMonthlyPaymentAmount(card) > 0 && remaining !== null && remaining >= 0 && remaining <= 7
  }).length
  const tone = usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Kredi kartları"
        description="Açık ekstre, limit ve yaklaşan son ödeme odağı."
        action={<StatusBadge tone={dueSoonCount > 0 ? 'warning' : 'good'}>{dueSoonCount > 0 ? `${dueSoonCount} yakın vade` : 'Kontrol altında'}</StatusBadge>}
      />
      <div className="mt-5">
        <AmountDisplay label="Toplam kart borcu" value={formatCurrency(totalDebt)} tone={tone} size="lg" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Açık ekstre" value={formatCurrency(statementDebt)} tone={statementDebt > 0 ? 'warning' : 'good'} />
        <MiniStat label="Kullanılabilir" value={formatCurrency(availableLimit)} tone="good" />
      </div>
      <div className="mt-5">
        <ProgressStrip label="Limit kullanımı" value={usageRate} tone={tone} detail={`${creditCards.length} kredi kartı takipte`} />
      </div>
      {visibleCards.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {visibleCards.map((card) => (
            <Link key={card.id} to="/kartlar?section=kartlar" className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-background/65 px-3 py-2.5 ring-1 ring-border/70 transition hover:bg-muted">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{card.card_name}</p>
                <p className="truncate text-xs text-muted-foreground">{card.bank_name}</p>
              </div>
              <p className="finance-value shrink-0 text-sm font-black text-foreground">{formatCurrency(card.debt_amount)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-background/65 p-3 text-sm text-muted-foreground ring-1 ring-border/70">Henüz kredi kartı yok; kart ekleyince ekstre ve limit takibi burada görünür.</p>
      )}
    </FinancePanel>
  )
}

export function GoalProgressCommand({ goalProgress }: { goalProgress: GoalProgressSummary }) {
  const tone = goalProgress.activeCount === 0 ? 'info' : goalProgress.averageProgress >= 70 ? 'good' : goalProgress.averageProgress >= 35 ? 'warning' : 'info'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Hedef ilerlemeleri"
        description="Aktif hedeflerin ortalama ilerleme durumu."
        action={<StatusBadge tone={tone}>{goalProgress.activeCount} hedef</StatusBadge>}
      />
      <div className="mt-5">
        <ProgressStrip label="Ortalama ilerleme" value={goalProgress.averageProgress} tone={tone} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Sıradaki hedef" value={goalProgress.nextGoalName ?? 'Henüz yok'} tone={goalProgress.nextGoalName ? 'premium' : 'neutral'} />
        <MiniStat label="Aylık ihtiyaç" value={formatCurrency(goalProgress.nextGoalMonthlyNeed)} tone={goalProgress.nextGoalMonthlyNeed > 0 ? 'warning' : 'neutral'} />
      </div>
    </FinancePanel>
  )
}

export function AnalyticsSnapshotPanel({
  cashFlow,
  totalAssets,
  totalDebts,
  cardDebt,
  loanDebt,
  personalDebt,
}: {
  cashFlow: CashFlowSummary
  totalAssets: number
  totalDebts: number
  cardDebt: number
  loanDebt: number
  personalDebt: number
}) {
  const assetDebtRatio = totalAssets > 0 ? Math.min(100, (totalDebts / totalAssets) * 100) : totalDebts > 0 ? 100 : 0

  const donutData: DonutSlice[] = [
    ...(cardDebt > 0    ? [{ name: 'Kart',    value: cardDebt,     color: 'var(--warning)' }]     : []),
    ...(loanDebt > 0    ? [{ name: 'Kredi',   value: loanDebt,     color: 'var(--info)' }]         : []),
    ...(personalDebt > 0? [{ name: 'Kişisel', value: personalDebt, color: 'var(--destructive)' }]  : []),
  ]

  return (
    <FinancePanel className="p-4 sm:p-5">
      <SectionHeader title="Analiz kartları" description="Gelir/gider ve borç dağılımını hızlı kontrol et." />
      <div className="mt-4 grid gap-3 min-[720px]:grid-cols-3">
        {/* Net flow card */}
        <MetricCard
          label="Gelir / Gider"
          value={`${cashFlow.netFlow >= 0 ? '+' : ''}${formatCurrency(cashFlow.netFlow)}`}
          description={`Gelir ${formatCurrency(cashFlow.income)} · Çıkış ${formatCurrency(cashFlow.outflow)}`}
          tone={cashFlow.netFlow >= 0 ? 'good' : 'danger'}
          icon={TrendingUp}
          deltaLabel={cashFlow.netFlow >= 0 ? 'up' : 'down'}
          delta={cashFlow.netFlow >= 0 ? 'Pozitif akış' : 'Nakit açığı'}
        />

        {/* Debt donut */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="finance-label mb-3">Borç Dağılımı</p>
          {donutData.length > 0 ? (
            <DonutChart data={donutData} size={176} innerRadius={48} totalLabel="Toplam Borç" />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              Borç kaydı yok
            </div>
          )}
        </div>

        {/* Asset/debt ratio */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <AmountDisplay
            label="Varlık / Borç Baskısı"
            value={`%${Math.round(assetDebtRatio)}`}
            tone={assetDebtRatio >= 80 ? 'danger' : assetDebtRatio >= 45 ? 'warning' : 'good'}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Varlık {formatCurrency(totalAssets)} · Borç {formatCurrency(totalDebts)}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <ProgressStrip label="Borç Baskısı" value={assetDebtRatio} tone={assetDebtRatio >= 80 ? 'danger' : assetDebtRatio >= 45 ? 'warning' : 'good'} />
          </div>
        </div>
      </div>
    </FinancePanel>
  )
}



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

export function CashFlowPanel({ cashFlow }: { cashFlow: CashFlowSummary }) {
  const outflowRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : 0
  const isPositive = cashFlow.netFlow >= 0

  // Build chart data from cashFlow breakdown
  const chartData: CashFlowPoint[] = cashFlow.income > 0 || cashFlow.outflow > 0 ? [
    {
      label: 'Gelir',
      income: cashFlow.income,
      outflow: 0,
      net: cashFlow.income,
    },
    {
      label: 'Kart',
      income: 0,
      outflow: cashFlow.cardOutflow,
      net: -cashFlow.cardOutflow,
    },
    {
      label: 'Kredi',
      income: 0,
      outflow: cashFlow.loanOutflow,
      net: -cashFlow.loanOutflow,
    },
    {
      label: 'Fatura',
      income: 0,
      outflow: cashFlow.paymentOutflow,
      net: -cashFlow.paymentOutflow,
    },
    {
      label: 'Net',
      income: Math.max(0, cashFlow.netFlow),
      outflow: Math.max(0, -cashFlow.netFlow),
      net: cashFlow.netFlow,
    },
  ] : []

  return (
    <Card variant="default" className="border-border/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="inline-flex items-center gap-1.5">
              Aylık nakit akışı
              <HelpTooltip title="Aylık nakit akışı" content={dashboardHelp.cashFlow} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{cashFlow.monthLabel}</p>
          </div>
          <Badge variant={isPositive ? 'success' : 'destructive'}>
            {isPositive ? 'Artıda' : 'Açık var'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {/* Summary pills */}
        <div className="grid grid-cols-3 gap-2">
          <CashFlowMetric label="Gelir" value={formatCurrency(cashFlow.income)} tone="emerald" />
          <CashFlowMetric label="Çıkış" value={formatCurrency(cashFlow.outflow)} tone="rose" />
          <CashFlowMetric label="Ay sonu" value={formatCurrency(cashFlow.projectedCash)} tone={cashFlow.projectedCash >= 0 ? 'emerald' : 'rose'} />
        </div>

        {/* Area chart */}
        {chartData.length > 0 && (
          <div className="rounded-xl bg-muted/20 p-2">
            <CashFlowChart data={chartData} height={180} />
          </div>
        )}

        {/* Outflow rate */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Gelire göre çıkış</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">%{Math.round(outflowRate)}</span>
          </div>
          <Progress value={outflowRate} autoColor size="default" />
        </div>

        {/* Detail grid */}
        <div className="grid gap-1.5 text-xs text-muted-foreground min-[430px]:grid-cols-2">
          <span>🏦 Kart: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.cardOutflow)}</span></span>
          <span>📋 Kredi: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.loanOutflow)}</span></span>
          <span>🧾 Fatura: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.paymentOutflow)}</span></span>
          <span>👤 Kişisel: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.debtOutflow)}</span></span>
          {cashFlow.receivableIncome > 0 ? (
            <span>📥 Tahsilat: <span className="font-mono font-medium text-success">{formatCurrency(cashFlow.receivableIncome)}</span></span>
          ) : null}
        </div>

        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
          <p className="text-xs text-muted-foreground">
            Hesap nakdi {formatCurrency(cashFlow.cashAssets)} · {cashFlow.recurringPayments} aylık ödeme
          </p>
          <p className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${isPositive ? 'text-success' : 'text-destructive'}`}>
            Net akış: {cashFlow.netFlow >= 0 ? '+' : ''}{formatCurrency(cashFlow.netFlow)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

type CashFlowCalendarGroup = {
  dayKey: string
  dateLabel: string
  amount: number
  cashImpactAmount: number
  cardSettledAmount: number
  count: number
  kinds: Set<UpcomingItem['kind']>
  cashAfter: number
  items: UpcomingItem[]
}

function buildCashFlowCalendarGroups(items: UpcomingItem[], startingCash: number): CashFlowCalendarGroup[] {
  const groups = new Map<string, Omit<CashFlowCalendarGroup, 'cashAfter'>>()

  for (const item of items) {
    const dayKey = new Date(item.sortTime).toLocaleDateString('sv-SE')
    const current = groups.get(dayKey)
    const nextItems = [...(current?.items ?? []), item]
    groups.set(dayKey, {
      dayKey,
      dateLabel: formatDate(dayKey),
      amount: roundTL((current?.amount ?? 0) + item.amount),
      cashImpactAmount: roundTL((current?.cashImpactAmount ?? 0) + item.cashImpactAmount),
      cardSettledAmount: roundTL((current?.cardSettledAmount ?? 0) + (item.settlement === 'credit_card' ? item.amount : 0)),
      count: nextItems.length,
      kinds: new Set([...(current?.kinds ?? []), item.kind]),
      items: nextItems,
    })
  }

  let runningCash = startingCash
  return Array.from(groups.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((group) => {
      runningCash = roundTL(runningCash - group.cashImpactAmount)
      return { ...group, cashAfter: runningCash }
    })
}

function kindLabel(kind: UpcomingItem['kind']) {
  if (kind === 'payment') return 'Ödeme'
  if (kind === 'card') return 'Kart'
  if (kind === 'loan') return 'Kredi'
  return 'Borç'
}

export function CashFlowCalendarPanel({ items, cashFlow }: { items: UpcomingItem[]; cashFlow: CashFlowSummary }) {
  const [showAll, setShowAll] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const groups = useMemo(() => buildCashFlowCalendarGroups(items, cashFlow.cashAssets), [cashFlow.cashAssets, items])
  const visibleGroups = showAll ? groups : groups.slice(0, 4)
  const selectedGroup = visibleGroups.find((group) => group.dayKey === selectedDayKey) ?? visibleGroups[0] ?? null
  const totalUpcoming = sum(items, (item) => item.amount)
  const totalCashImpact = sum(items, (item) => item.cashImpactAmount)
  const totalCardSettled = roundTL(Math.max(0, totalUpcoming - totalCashImpact))
  const lowestCash = groups.reduce((lowest, group) => Math.min(lowest, group.cashAfter), cashFlow.cashAssets)

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Nakit takvimi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Önümüzdeki {UPCOMING_DAYS} gün için günlük ödeme yoğunluğu.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={lowestCash < 0 ? 'destructive' : 'secondary'}>
              {groups.length > 0 ? `${groups.length} gün · nakit ${formatCurrency(totalCashImpact)}` : 'Takvim temiz'}
            </Badge>
            {totalCardSettled > 0 ? <Badge variant="info">Kart {formatCurrency(totalCardSettled)}</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {groups.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-success/10 px-3 py-3 text-sm text-success">
            <CheckCircle2 className="size-5 shrink-0" />
            <span>Yaklaşan ödeme yok; bu dönem nakit takvimi sakin görünüyor.</span>
          </div>
        ) : (
          <>
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleGroups.map((group) => {
                const cashTone = group.cashAfter < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                const cashBadgeClass = group.cashImpactAmount > 0
                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                const isSelected = selectedGroup?.dayKey === group.dayKey

                return (
                  <button
                    key={group.dayKey}
                    type="button"
                    onClick={() => setSelectedDayKey(group.dayKey)}
                    aria-pressed={isSelected}
                    className={`rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200 dark:border-emerald-900/80 dark:bg-emerald-950/25 dark:ring-emerald-900/70'
                        : 'border-border bg-card/70 hover:bg-muted/45'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-foreground">{group.dateLabel}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {Array.from(group.kinds).map(kindLabel).join(' · ')} · {group.count} kayıt
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`rounded-lg px-2 py-1 text-xs font-black tabular-nums ${cashBadgeClass}`}>
                          {group.cashImpactAmount > 0 ? `Nakit ${formatCurrency(group.cashImpactAmount)}` : 'Nakit etkisi yok'}
                        </span>
                        {group.cardSettledAmount > 0 ? (
                          <span className="rounded-lg bg-info/10 px-2 py-1 text-[11px] font-black tabular-nums text-info">
                            Kart {formatCurrency(group.cardSettledAmount)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className={`mt-3 text-xs font-bold tabular-nums ${cashTone}`}>Bu gün sonrası tahmini nakit: {formatCurrency(group.cashAfter)}</p>
                  </button>
                )
              })}
            </div>
            {selectedGroup ? (
              <div className="rounded-lg border border-primary/15 bg-primary/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-emerald-950 dark:text-emerald-50">{selectedGroup.dateLabel}</p>
                    <p className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
                      {selectedGroup.count} kayıt · nakit etkisi {formatCurrency(selectedGroup.cashImpactAmount)}
                      {selectedGroup.cardSettledAmount > 0 ? ` · kart ${formatCurrency(selectedGroup.cardSettledAmount)}` : ''}
                    </p>
                  </div>
                  <Badge variant={selectedGroup.cashAfter < 0 ? 'destructive' : 'secondary'}>
                    Sonra {formatCurrency(selectedGroup.cashAfter)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedGroup.items.map((item) => (
                    <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-card/80 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{item.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.settlement === 'credit_card' ? 'Karttan işlenecek' : kindLabel(item.kind)}
                          {item.subtitle ? ` · ${item.subtitle}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className={`whitespace-nowrap rounded-lg px-2 py-1 text-xs font-black tabular-nums ${
                          item.settlement === 'credit_card'
                            ? 'bg-info/10 text-info'
                            : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/45 dark:text-emerald-100'
                        }`}>
                          {item.settlement === 'credit_card' ? 'Kart ' : ''}{item.value}
                        </span>
                        {item.cashImpactAmount !== item.amount ? (
                          <span className="text-[10px] font-bold text-muted-foreground">Nakit {formatCurrency(item.cashImpactAmount)}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {groups.length > 4 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Takvimi daralt' : `Tüm günleri göster (${groups.length})`}
              </button>
            ) : null}
          </>
        )}
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

export function CurrentDebtTotalsPanel({
  totalDebt,
  cardDebt,
  loanDebt,
  personalDebt,
  paymentDebt,
}: {
  totalDebt: number
  cardDebt: number
  loanDebt: number
  personalDebt: number
  paymentDebt: number
}) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="inline-flex items-center gap-1.5">
          Güncel borç toplamları
          <HelpTooltip title="Güncel borç toplamları" content={dashboardHelp.currentDebt} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 pt-0">
        <CashFlowMetric label="Toplam borç" value={formatCurrency(totalDebt)} tone="rose" />
        <CashFlowMetric label="Kart borcu" value={formatCurrency(cardDebt)} tone="rose" />
        <CashFlowMetric label="Kredi borcu" value={formatCurrency(loanDebt)} tone="rose" />
        <CashFlowMetric label="Kişisel borç" value={formatCurrency(personalDebt)} tone="rose" />
        <CashFlowMetric label="Fatura/ödeme" value={formatCurrency(paymentDebt)} tone="rose" />
      </CardContent>
    </Card>
  )
}

function CashFlowMetric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'

  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2 min-[430px]:px-3">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-[clamp(0.7rem,3vw,1rem)] font-extrabold leading-tight tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  )
}

export function MetricTile({
  label,
  value,
  icon,
  tone,
  help,
}: {
  label: string
  value: string
  icon: ReactNode
  tone: 'emerald' | 'rose' | 'amber' | 'indigo' | 'stone'
  help?: HelpTooltipContent
}) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900',
    stone: 'bg-muted text-muted-foreground ring-border',
  }[tone]

  return (
    <Card size="sm" className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
            {help ? <HelpTooltip title={label} content={help} /> : null}
          </div>
          <p className="mt-1 whitespace-nowrap text-[clamp(0.78rem,3.3vw,1.25rem)] font-extrabold leading-tight tabular-nums text-foreground">{value}</p>
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${toneClass}`}>{icon}</div>
      </CardContent>
    </Card>
  )
}

export function CreditLimitSection({ groups, totalUsageRate }: { groups: CreditLimitGroup[]; totalUsageRate: number }) {
  if (groups.length === 0) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="inline-flex items-center gap-1.5">
            Kart limitleri
            <HelpTooltip title="Kart limitleri" content={dashboardHelp.creditLimit} />
          </CardTitle>
          <Badge variant="secondary">%{Math.round(totalUsageRate)} kullanım</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-1">
        {groups.slice(0, 3).map((group) => (
          <div key={group.key} className="rounded-lg bg-muted/55 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{group.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {group.cards.length} kart · kalan {formatCurrency(group.available)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-extrabold tabular-nums text-foreground">{formatCurrency(group.debt)}</p>
            </div>
            <Progress value={group.usageRate} className="mt-3 h-1.5" />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>Limit {formatCurrency(group.limit)}</span>
              <span>%{Math.round(group.usageRate)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function PulseCard({ title, label, value, description, icon, tone }: { title: string; label: string; value: string; description: string; icon: ReactNode; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/30' : 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/30'

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${toneClass}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-muted-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-extrabold tabular-nums text-foreground">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function SalaryPulse({ trend }: { trend: ReturnType<typeof getSalaryTrend> }) {
  if (!trend.current) {
    return (
      <PulseCard
        title="Maaş trendi"
        label="Henüz kayıt yok"
        value="-"
        description="Maaş geçmişi varlıklara dahil edilmez"
        icon={<TrendingUp />}
        tone="emerald"
      />
    )
  }

  const trendLabel = trend.previous
    ? `${trend.difference >= 0 ? '+' : ''}${formatCurrency(trend.difference)} · ${trend.percentage >= 0 ? '+' : ''}${trend.percentage.toFixed(1)}%`
    : 'İlk maaş kaydı'

  return (
    <PulseCard
      title="Maaş trendi"
      label={formatDate(trend.current.effective_date)}
      value={formatCurrency(trend.current.amount)}
      description={trendLabel}
      icon={<TrendingUp />}
      tone="emerald"
    />
  )
}

export function HistorySection({ rows }: { rows: TransactionHistory[] }) {
  const [activeType, setActiveType] = useState<TransactionHistoryType | 'all'>('all')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const filteredRows = (activeType === 'all' ? rows : rows.filter((row) => row.type === activeType)).filter((row) =>
    normalizedQuery ? `${row.title} ${row.note ?? ''} ${row.type}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery) : true,
  )
  const groupedRows = groupHistoryRows(filteredRows.slice(0, 40))

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Son güncellemeler</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Son 3 ay işlem geçmişi ve hesap hareketleri.</p>
          </div>
          <Badge variant="secondary">{filteredRows.length} kayıt</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Geçmişte ara"
            className="pl-9 text-sm"
          />
        </label>
        <div className="finance-scrollbar flex gap-2 overflow-x-auto pb-1">
          {historyFilters.map((filter) => {
            const isActive = activeType === filter.value

            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveType(filter.value)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
      {rows.length === 0 ? (
        <EmptyState title="İşlem geçmişi yok" description="Planlı ödemeler, transferler ve borç kapatma işlemleri burada görünecek." />
      ) : filteredRows.length === 0 ? (
        <EmptyState title="Bu filtrede işlem yok" description="Farklı bir işlem türü seçerek geçmiş kayıtları görebilirsiniz." />
      ) : (
        <div className="space-y-5">
          {groupedRows.map((group) => (
            <section key={group.label} className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="shrink-0 text-xs font-bold uppercase text-muted-foreground">{group.label}</h3>
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
              </div>
              <div className="space-y-2">
                {group.rows.map((row) => (
                  <article key={row.id} className="flex gap-3 rounded-lg border border-border/75 bg-card/80 p-3 shadow-sm">
                    <div className={`mt-1 size-2.5 shrink-0 rounded-full ${historyDotClass(row.type)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{row.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatHistoryDate(row.occurred_at)}</p>
                        </div>
                        {row.amount !== null ? (
                          <span className="finance-value shrink-0 rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
                            {formatCurrency(row.amount)}
                          </span>
                        ) : null}
                      </div>
                      {row.note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.note}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  )
}

function groupHistoryRows(rows: TransactionHistory[]) {
  const groups = new Map<string, TransactionHistory[]>()

  for (const row of rows) {
    const label = formatHistoryDay(row.occurred_at)
    groups.set(label, [...(groups.get(label) ?? []), row])
  }

  return Array.from(groups, ([label, groupRows]) => ({ label, rows: groupRows }))
}

function formatHistoryDay(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toLocaleDateString('sv-SE') === today.toLocaleDateString('sv-SE')) return 'Bugün'
  if (date.toLocaleDateString('sv-SE') === yesterday.toLocaleDateString('sv-SE')) return 'Dün'

  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function historyDotClass(type: TransactionHistoryType) {
  const classes: Record<TransactionHistoryType, string> = {
    payment: 'bg-amber-500',
    transfer: 'bg-sky-500',
    loan: 'bg-rose-500',
    debt: 'bg-violet-500',
    card: 'bg-emerald-500',
  }

  return classes[type]
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
