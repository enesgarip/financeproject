import { Plus } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { bottomNavItems } from './navigation'
import { QuickActionsFab, quickExpensePath, useQuickActions } from './QuickActions'

/** İşlem alanı alt gezinmenin parçasıdır; ayrı yüzen katman tutarları örtmez. */
export function BottomNav() {
  const { pathname, search } = useLocation()
  const enteringExpense = pathname === '/kartlar' && new URLSearchParams(search).get('panel') === 'manuel'
  const { tucked } = useQuickActions()
  return (
    <div className={cn('fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-raised md:hidden', tucked && 'hidden')}>
      {!enteringExpense ? <div className="flex items-center gap-2 px-4 pb-2 pt-2.5">
        <Link to={quickExpensePath} className="interaction-press flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
          <Plus size={20} strokeWidth={1.8} aria-hidden="true" />Harcama ekle
        </Link>
        <QuickActionsFab />
      </div> : null}
      <nav aria-label="Ana gezinme" className="grid grid-cols-5 gap-0.5 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-1">
        {bottomNavItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className="interaction-press flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl">
            {({ isActive }) => {
              const active = isActive || item.activePaths?.includes(pathname)
              return <>
                <item.icon size={21} strokeWidth={active ? 2.1 : 1.8} className="text-primary" aria-hidden="true" />
                <span className={cn('text-xs leading-4', active ? 'font-semibold text-primary' : 'text-ink-muted')}>{item.label}</span>
              </>
            }}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
