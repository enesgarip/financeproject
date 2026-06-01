import { NavLink } from 'react-router-dom'
import { bottomNavItems } from './navigation'

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 min-h-[calc(4.65rem+env(safe-area-inset-bottom))] border-t border-border/80 bg-card/96 px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 shadow-[0_-14px_34px_rgba(15,23,42,0.09)] backdrop-blur-xl supports-[height:100dvh]:bottom-0 dark:shadow-[0_-14px_34px_rgba(0,0,0,0.38)] lg:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        {bottomNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex h-[3.35rem] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[9.5px] font-bold leading-none transition min-[390px]:px-1 min-[390px]:text-[10px] ${
                isActive
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/20 shadow-sm'
                  : 'text-muted-foreground active:bg-muted hover:text-foreground'
              }`
            }
          >
            <item.icon size={20} strokeWidth={2.2} />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
