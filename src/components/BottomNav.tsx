import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { bottomNavItems } from './navigation'

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav
      className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-30 rounded-2xl border border-border/75 p-1.5 lg:hidden"
      style={{
        background: 'color-mix(in srgb, var(--card) 90%, transparent)',
        backdropFilter: 'blur(24px)',
        boxShadow: 'var(--shadow-floating)',
      }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => {
              const itemIsActive =
                isActive ||
                ('activePaths' in item &&
                  (item.activePaths as readonly string[]).includes(pathname))
              return cn(
                'relative flex min-h-[3.35rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1',
                'text-[10px] font-semibold leading-none transition-all',
                itemIsActive
                  ? [
                      'bg-primary text-primary-foreground shadow-[0_4px_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]',
                    ].join(' ')
                  : 'text-muted-foreground hover:bg-muted/70 active:bg-muted',
              )
            }}
          >
            {({ isActive }) => {
              const itemIsActive =
                isActive ||
                ('activePaths' in item &&
                  (item.activePaths as readonly string[]).includes(pathname))
              return (
                <>
                  <item.icon
                    size={19}
                    strokeWidth={itemIsActive ? 2.5 : 1.8}
                    className={itemIsActive ? 'text-primary-foreground' : 'text-muted-foreground'}
                  />
                  <span className={cn('truncate', itemIsActive ? 'text-primary-foreground' : '')}>
                    {item.label}
                  </span>
                </>
              )
            }}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
