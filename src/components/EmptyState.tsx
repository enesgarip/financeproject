import { BarChart3, Inbox, PiggyBank, Plus, Receipt, Target, Users, WalletCards } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '../lib/utils'

type EmptyStateVariant =
  | 'default'
  | 'transactions'
  | 'budget'
  | 'goals'
  | 'accounts'
  | 'debts'
  | 'reports'
  | 'payments'

const variantConfig: Record<
  EmptyStateVariant,
  { icon: ComponentType<{ className?: string }>; color: string; bg: string }
> = {
  default:      { icon: Inbox,       color: 'text-primary',     bg: 'bg-primary/10' },
  transactions: { icon: Receipt,     color: 'text-info',        bg: 'bg-info/10' },
  budget:       { icon: WalletCards, color: 'text-warning',     bg: 'bg-warning/10' },
  goals:        { icon: Target,      color: 'text-success',     bg: 'bg-success/10' },
  accounts:     { icon: PiggyBank,   color: 'text-primary',     bg: 'bg-primary/10' },
  debts:        { icon: Users,       color: 'text-destructive', bg: 'bg-destructive/10' },
  reports:      { icon: BarChart3,   color: 'text-info',        bg: 'bg-info/10' },
  payments:     { icon: WalletCards, color: 'text-warning',     bg: 'bg-warning/10' },
}

type EmptyStateProps = {
  title: string
  description: string
  action?: ReactNode
  variant?: EmptyStateVariant
  size?: 'sm' | 'default' | 'lg'
  className?: string
}

export function EmptyState({
  title,
  description,
  action,
  variant = 'default',
  size = 'default',
  className,
}: EmptyStateProps) {
  const { icon: Icon, color, bg } = variantConfig[variant]

  const paddingClass = {
    sm:      'px-4 py-7',
    default: 'px-5 py-10 sm:px-8 sm:py-12',
    lg:      'px-6 py-14 sm:px-10 sm:py-16',
  }[size]

  const iconSizeClass = {
    sm:      'size-10',
    default: 'size-14',
    lg:      'size-16',
  }[size]

  const titleClass = {
    sm:      'text-sm font-semibold',
    default: 'text-base font-bold',
    lg:      'text-lg font-bold',
  }[size]

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-xl rounded-2xl border border-dashed border-border/70 bg-card/80 text-center',
        'shadow-[var(--shadow-card)]',
        paddingClass,
        className,
      )}
    >
      {/* Icon */}
      <div className={cn('mx-auto grid place-items-center rounded-2xl ring-1', iconSizeClass, bg, color,
        'ring-current/20')}>
        <Icon className="size-[40%]" />
      </div>

      {/* Text */}
      <h3 className={cn('mt-4 leading-snug text-foreground', titleClass)}>{title}</h3>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* CTA */}
      {action ? (
        <div className="mt-5 flex justify-center">{action}</div>
      ) : (
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border/60">
          <Plus size={12} />
          İlk kayıtla ekran anlam kazanır
        </div>
      )}
    </div>
  )
}
