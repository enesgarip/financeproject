import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { bottomNavItems } from './navigation'

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 lg:hidden"
      style={{
        background: 'color-mix(in srgb, var(--card) 92%, transparent)',
        backdropFilter: 'blur(24px)',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.12)',
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
                'flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1',
                'text-[10px] font-semibold leading-none transition-all',
                itemIsActive
                  ? [
                      'bg-primary/15 text-primary',
                      'dark:bg-primary/20',
                    ].join(' ')
                  : 'text-muted-foreground active:bg-muted',
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
                    className={itemIsActive ? 'text-primary' : 'text-muted-foreground'}
                  />
                  <span className={cn('truncate', itemIsActive ? 'text-primary' : '')}>
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
