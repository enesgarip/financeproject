import {
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FinancePanel, MiniStat, PageHero, ProgressStrip, SectionHeader, StatusBadge } from '../finance/FinanceUI'
import { Card, CardContent } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { formatDate } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import {
  getSalaryTrend,
  type CashFlowSummary,
  type FinancialHealthSummary,
  type GoalProgressSummary,
} from '../../utils/financeSummary'

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
        className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:text-emerald-400 dark:ring-emerald-500/25"
      >
        <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />
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
      className={`flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ring-1 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        tone === 'destructive'
          ? 'bg-destructive/12 text-destructive ring-destructive/25'
          : 'bg-warning/12 text-warning ring-warning/25'
      }`}
    >
      <ShieldAlert size={16} className="shrink-0" aria-hidden="true" />
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
          <p
            title={value}
            className="mt-1 block max-w-full truncate whitespace-nowrap text-[clamp(0.78rem,3.3vw,1.25rem)] font-extrabold leading-tight tabular-nums text-foreground"
          >
            {value}
          </p>
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${toneClass}`} aria-hidden="true">{icon}</div>
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
