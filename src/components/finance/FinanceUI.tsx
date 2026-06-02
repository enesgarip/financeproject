import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Info, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

type Tone = 'neutral' | 'good' | 'warning' | 'danger' | 'info' | 'premium'

const toneSurfaceClass: Record<Tone, string> = {
  neutral: 'border-border/80 bg-card/92 text-foreground ring-border/70',
  good: 'border-success/20 bg-success/10 text-success ring-success/15',
  warning: 'border-warning/25 bg-warning/10 text-warning ring-warning/20',
  danger: 'border-destructive/20 bg-destructive/10 text-destructive ring-destructive/20',
  info: 'border-info/20 bg-info/10 text-info ring-info/20',
  premium: 'border-primary/20 bg-primary/10 text-primary ring-primary/18',
}

const toneTextClass: Record<Tone, string> = {
  neutral: 'text-foreground',
  good: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
  premium: 'text-primary',
}

const statusIcon: Record<Exclude<Tone, 'neutral' | 'premium'>, ComponentType<{ className?: string }>> = {
  good: CheckCircle2,
  warning: Clock3,
  danger: AlertTriangle,
  info: Info,
}

export function AppPage({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('flex min-w-0 flex-col gap-4 sm:gap-5', className)}>{children}</section>
}

export function FinancePanel({
  className,
  children,
  tone = 'neutral',
}: {
  className?: string
  children: ReactNode
  tone?: Tone
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border shadow-[var(--shadow-card)] ring-1 backdrop-blur-md transition-shadow hover:shadow-[var(--shadow-card-hover)]',
        toneSurfaceClass[tone],
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PageHero({
  label,
  title,
  amount,
  description,
  tone = 'premium',
  children,
  action,
  className,
}: {
  label: string
  title: string
  amount?: string
  description?: string
  tone?: Tone
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <FinancePanel
      tone={tone}
      className={cn(
        'relative overflow-hidden p-5 sm:p-6',
        'bg-[linear-gradient(135deg,color-mix(in_srgb,var(--card)_96%,var(--primary)_4%),color-mix(in_srgb,var(--accent)_68%,var(--card)_32%))]',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-info to-warning" />
      <div className="relative flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-muted-foreground">{label}</p>
            <h2 className="mt-2 text-[clamp(1.45rem,6vw,2.75rem)] font-black leading-none text-foreground">{title}</h2>
            {amount ? (
              <p className={cn('finance-value mt-3 text-[clamp(2rem,10vw,4rem)] font-black leading-none', toneTextClass[tone])}>
                {amount}
              </p>
            ) : null}
            {description ? <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          <div className="hidden shrink-0 sm:block">{action}</div>
        </div>
        {children}
        {action ? <div className="sm:hidden">{action}</div> : null}
      </div>
    </FinancePanel>
  )
}

export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-black leading-tight text-foreground sm:text-lg">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function AmountDisplay({
  label,
  value,
  tone = 'neutral',
  size = 'md',
}: {
  label?: string
  value: string
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = {
    sm: 'text-base',
    md: 'text-[clamp(1.15rem,4vw,1.65rem)]',
    lg: 'text-[clamp(1.8rem,8vw,3rem)]',
  }[size]

  return (
    <div className="min-w-0">
      {label ? <p className="truncate text-[11px] font-black uppercase text-muted-foreground">{label}</p> : null}
      <p className={cn('finance-value mt-1 truncate font-black leading-none', sizeClass, toneTextClass[tone])}>{value}</p>
    </div>
  )
}

export function MetricCard({
  label,
  value,
  description,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string
  value: string
  description?: string
  tone?: Tone
  icon?: ComponentType<{ className?: string }>
}) {
  return (
    <FinancePanel tone={tone} className="p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <AmountDisplay label={label} value={value} tone={tone} size="md" />
        {Icon ? (
          <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg ring-1', toneSurfaceClass[tone])}>
            <Icon className="size-4" />
          </div>
        ) : null}
      </div>
      {description ? <p className="mt-3 text-xs font-medium leading-5 text-muted-foreground">{description}</p> : null}
    </FinancePanel>
  )
}

export function StatusBadge({
  tone = 'neutral',
  children,
  icon,
  className,
}: {
  tone?: Tone
  children: ReactNode
  icon?: ReactNode
  className?: string
}) {
  const Icon = tone === 'neutral' || tone === 'premium' ? null : statusIcon[tone]

  return (
    <span
      className={cn(
        'inline-flex min-h-6 max-w-full items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-black leading-none ring-1',
        toneSurfaceClass[tone],
        className,
      )}
    >
      {icon ?? (Icon ? <Icon className="size-3.5 shrink-0" /> : <Sparkles className="size-3.5 shrink-0" />)}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function MiniStat({
  label,
  value,
  tone = 'neutral',
  className,
}: {
  label: string
  value: string
  tone?: Tone
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-lg bg-surface-muted/80 px-3 py-2 ring-1 ring-border/70', className)}>
      <p className="truncate text-[11px] font-black uppercase text-muted-foreground">{label}</p>
      <p className={cn('finance-value mt-1 truncate text-sm font-black leading-tight', toneTextClass[tone])}>{value}</p>
    </div>
  )
}

export function ProgressStrip({
  label,
  value,
  detail,
  tone = 'premium',
}: {
  label: string
  value: number
  detail?: string
  tone?: Tone
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="truncate font-black uppercase text-muted-foreground">{label}</span>
        <span className={cn('shrink-0 font-black tabular-nums', toneTextClass[tone])}>%{Math.round(value)}</span>
      </div>
      <Progress value={Math.min(100, Math.max(0, value))} className="h-2 bg-muted/75 [&_[data-slot=progress-indicator]]:bg-primary" />
      {detail ? <p className="mt-2 text-xs font-medium leading-5 text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-lg border border-border/80 bg-surface-muted/45 p-3 sm:p-4', className)}>
      <SectionHeader title={title} description={description} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}
