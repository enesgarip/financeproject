import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { bottomNavItems } from './navigation'

export function BottomNav() {
  const { pathname } = useLocation()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 min-h-[calc(4.85rem+env(safe-area-inset-bottom))] border-t border-border/80 bg-card/94 px-2 pb-[max(env(safe-area-inset-bottom),0.55rem)] pt-2 shadow-[0_-16px_38px_rgba(16,24,40,0.12)] backdrop-blur-xl supports-[height:100dvh]:bottom-0 dark:shadow-[0_-16px_38px_rgba(0,0,0,0.42)] lg:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1.5">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => {
              const itemIsActive = isActive || ('activePaths' in item && (item.activePaths as readonly string[]).includes(pathname))
              return cn(
                'flex h-[3.4rem] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[10px] font-black leading-none transition min-[390px]:px-1',
                itemIsActive
                  ? 'bg-primary text-primary-foreground ring-1 ring-primary/20 shadow-sm shadow-primary/20'
                  : 'text-muted-foreground active:bg-muted hover:text-foreground',
              )
            }}
          >
            <item.icon size={20} strokeWidth={2.2} />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
