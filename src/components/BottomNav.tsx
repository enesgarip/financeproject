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
    <nav className="fixed inset-x-0 bottom-0 z-30 min-h-[calc(4.5rem+env(safe-area-inset-bottom))] border-t border-stone-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.45rem)] pt-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur supports-[height:100dvh]:bottom-0 dark:border-stone-800 dark:bg-stone-950/95 dark:shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[9.5px] font-semibold leading-none transition min-[390px]:px-1 min-[390px]:text-[10px] ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'text-stone-500 active:bg-stone-100 dark:text-stone-400 dark:active:bg-stone-900'
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
