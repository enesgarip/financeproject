import { BarChart3, Inbox, PiggyBank, Receipt, Target, Users, WalletCards, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
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

const variantIcons: Record<EmptyStateVariant, LucideIcon> = {
  default: Inbox,
  transactions: Receipt,
  budget: WalletCards,
  goals: Target,
  accounts: PiggyBank,
  debts: Users,
  reports: BarChart3,
  payments: WalletCards,
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
  const Icon = variantIcons[variant]

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
        'mx-auto w-full max-w-xl rounded-2xl border border-dashed border-line-strong bg-raised text-center',
        '',
        paddingClass,
        className,
      )}
    >
      {/* Icon */}
      <div className={cn('mx-auto grid place-items-center rounded-2xl bg-primary/10 text-primary ring-1', iconSizeClass,
        'ring-current/20')}>
        <Icon className="size-[40%]" strokeWidth={1.8} aria-hidden="true" />
      </div>

      {/* Text */}
      <h3 className={cn('mt-4 leading-snug text-ink', titleClass)}>{title}</h3>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-muted">
        {description}
      </p>

      {/* CTA */}
      {action ? (
        <div className="mt-5 flex justify-center">{action}</div>
      ) : null}
    </div>
  )
}
