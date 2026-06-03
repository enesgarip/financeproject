import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3, Info, Minus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

type Tone = 'neutral' | 'good' | 'warning' | 'danger' | 'info' | 'premium'

const toneSurfaceClass: Record<Tone, string> = {
  neutral: 'border-border/70 bg-card text-foreground',
  good:    'border-success/20 bg-success/8 text-success dark:bg-success/12',
  warning: 'border-warning/25 bg-warning/8 text-warning dark:bg-warning/12',
  danger:  'border-destructive/20 bg-destructive/8 text-destructive dark:bg-destructive/12',
  info:    'border-info/20 bg-info/8 text-info dark:bg-info/12',
  premium: 'border-primary/20 bg-primary/8 text-primary dark:bg-primary/12',
}

const toneTextClass: Record<Tone, string> = {
  neutral: 'text-foreground',
  good:    'text-success',
  warning: 'text-warning',
  danger:  'text-destructive',
  info:    'text-info',
  premium: 'text-primary',
}

const toneBgClass: Record<Tone, string> = {
  neutral: 'bg-muted/50',
  good:    'bg-success/12 dark:bg-success/18',
  warning: 'bg-warning/12 dark:bg-warning/18',
  danger:  'bg-destructive/12 dark:bg-destructive/18',
  info:    'bg-info/12 dark:bg-info/18',
  premium: 'bg-primary/12 dark:bg-primary/18',
}

const statusIcon: Record<Exclude<Tone, 'neutral' | 'premium'>, ComponentType<{ className?: string }>> = {
  good:    CheckCircle2,
  warning: Clock3,
  danger:  AlertTriangle,
  info:    Info,
}

/* ─── Page wrapper ─── */
export function AppPage({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('flex min-w-0 flex-col gap-4 sm:gap-6', className)}>{children}</section>
}

/* ─── Finance Panel ─── */
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
        'min-w-0 rounded-2xl border shadow-[var(--shadow-card)] transition-shadow',
        'hover:shadow-[var(--shadow-lifted)]',
        toneSurfaceClass[tone],
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ─── Page Hero ─── */
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
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-2xl border p-5 sm:p-7',
        'shadow-[var(--shadow-lifted)]',
        toneSurfaceClass[tone],
        className,
      )}
      style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--card) 94%, var(--primary) 6%), color-mix(in srgb, var(--accent) 55%, var(--card) 45%))',
      }}
    >
      {/* Top accent line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary via-info to-warning opacity-80" />

      {/* Background glow */}
      <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-primary/5 blur-3xl" />

      <div className="relative flex min-w-0 flex-col gap-5">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="finance-label">{label}</p>
            <h2 className="mt-2 text-[clamp(1.35rem,5vw,2.5rem)] font-bold leading-none tracking-tight text-foreground">
              {title}
            </h2>
            {amount ? (
              <p className={cn(
                'finance-value mt-3 text-[clamp(1.75rem,9vw,3.5rem)] font-bold leading-none',
                toneTextClass[tone],
              )}>
                {amount}
              </p>
            ) : null}
            {description ? (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="hidden shrink-0 sm:block">{action}</div>
        </div>
        {children}
        {action ? <div className="sm:hidden">{action}</div> : null}
      </div>
    </div>
  )
}

/* ─── Section Header ─── */
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
        <h2 className="text-base font-bold leading-tight tracking-tight text-foreground sm:text-lg">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/* ─── Amount Display ─── */
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
    md: 'text-[clamp(1.1rem,3.5vw,1.5rem)]',
    lg: 'text-[clamp(1.75rem,7vw,3rem)]',
  }[size]

  return (
    <div className="min-w-0">
      {label ? (
        <p className="finance-label truncate">{label}</p>
      ) : null}
      <p className={cn('finance-value mt-1 truncate font-bold leading-none', sizeClass, toneTextClass[tone])}>
        {value}
      </p>
    </div>
  )
}

/* ─── Metric Card (hero stats) ─── */
export function MetricCard({
  label,
  value,
  description,
  delta,
  deltaLabel,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  label: string
  value: string
  description?: string
  delta?: string
  deltaLabel?: 'up' | 'down' | 'flat'
  tone?: Tone
  icon?: ComponentType<{ className?: string }>
  className?: string
}) {
  const DeltaIcon =
    deltaLabel === 'up' ? ArrowUpRight :
    deltaLabel === 'down' ? ArrowDownRight :
    Minus

  const deltaColorClass =
    deltaLabel === 'up' ? 'text-success' :
    deltaLabel === 'down' ? 'text-destructive' :
    'text-muted-foreground'

  return (
    <div
      className={cn(
        'group/metric relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-4 sm:p-5',
        'shadow-[var(--shadow-card)] transition-all duration-250',
        'hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)] hover:border-primary/20',
        'dark:ring-1 dark:ring-white/[0.04]',
        className,
      )}
    >
      {/* Background accent on hover */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/0 to-primary/0 opacity-0 transition-opacity duration-250 group-hover/metric:opacity-100"
        style={{ background: 'radial-gradient(ellipse at top right, color-mix(in srgb, var(--primary) 5%, transparent), transparent 70%)' }} />

      <div className="relative flex min-w-0 flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <p className="finance-label truncate">{label}</p>
          {Icon ? (
            <div className={cn(
              'grid size-8 shrink-0 place-items-center rounded-xl',
              toneBgClass[tone],
              toneTextClass[tone],
            )}>
              <Icon className="size-4" />
            </div>
          ) : null}
        </div>

        <p className={cn(
          'finance-value text-[clamp(1.25rem,4vw,1.75rem)] font-bold leading-none',
          toneTextClass[tone],
        )}>
          {value}
        </p>

        {(delta || description) ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {delta ? (
              <span className={cn('inline-flex items-center gap-0.5 text-xs font-semibold', deltaColorClass)}>
                <DeltaIcon size={12} />
                {delta}
              </span>
            ) : null}
            {description ? (
              <span className="truncate text-xs text-muted-foreground">{description}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ─── Status Badge ─── */
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
        'inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-xs font-semibold leading-none',
        toneSurfaceClass[tone],
        className,
      )}
    >
      {icon ?? (Icon ? <Icon className="size-3.5 shrink-0" /> : <Sparkles className="size-3.5 shrink-0" />)}
      <span className="truncate">{children}</span>
    </span>
  )
}

/* ─── Mini Stat ─── */
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
    <div className={cn(
      'min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5',
      className,
    )}>
      <p className="finance-label truncate">{label}</p>
      <p className={cn('finance-value mt-1.5 truncate text-sm font-bold leading-tight', toneTextClass[tone])}>
        {value}
      </p>
    </div>
  )
}

/* ─── Progress Strip ─── */
export function ProgressStrip({
  label,
  value,
  detail,
  tone = 'premium',
  size = 'default',
}: {
  label: string
  value: number
  detail?: string
  tone?: Tone
  size?: 'sm' | 'default' | 'lg'
}) {
  const clampedValue = Math.min(100, Math.max(0, value))

  const progressColor =
    tone === 'good' ? 'success' :
    tone === 'warning' ? 'warning' :
    tone === 'danger' ? 'danger' :
    tone === 'info' ? 'info' :
    'primary'

  return (
    <div className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="finance-label truncate">{label}</span>
        <span className={cn('shrink-0 font-bold tabular-nums', toneTextClass[tone])}>
          %{Math.round(clampedValue)}
        </span>
      </div>
      <Progress
        value={clampedValue}
        color={progressColor as 'primary' | 'success' | 'warning' | 'danger' | 'info'}
        size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'default'}
      />
      {detail ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  )
}

/* ─── Form Section ─── */
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
    <section className={cn(
      'rounded-xl border border-border/70 bg-muted/20 p-4 sm:p-5',
      className,
    )}>
      <SectionHeader title={title} description={description} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}
