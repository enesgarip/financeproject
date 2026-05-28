import { BarChart3, CreditCard, Home, MoreHorizontal, WalletCards } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/kartlar', label: 'Kartlar', icon: CreditCard },
  { to: '/odemeler', label: 'Ödemeler', icon: WalletCards },
  { to: '/analiz', label: 'Analiz', icon: BarChart3 },
  { to: '/daha', label: 'Daha', icon: MoreHorizontal },
]

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 min-h-[calc(4.5rem+env(safe-area-inset-bottom))] border-t border-border/80 bg-card/95 px-2 pb-[max(env(safe-area-inset-bottom),0.45rem)] pt-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl supports-[height:100dvh]:bottom-0 dark:shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-[9.5px] font-semibold leading-none transition min-[390px]:px-1 min-[390px]:text-[10px] ${
                isActive
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/15'
                  : 'text-muted-foreground active:bg-muted'
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
