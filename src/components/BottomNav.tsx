import { Banknote, CreditCard, HandCoins, Home, Landmark, WalletCards } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/varliklar', label: 'Varlıklar', icon: Banknote },
  { to: '/kartlar', label: 'Kartlar', icon: CreditCard },
  { to: '/krediler', label: 'Krediler', icon: Landmark },
  { to: '/borclar', label: 'Borçlar', icon: HandCoins },
  { to: '/odemeler', label: 'Ödemeler', icon: WalletCards },
]

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/95 dark:shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
      <div className="mx-auto grid max-w-xl grid-cols-6 gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex h-[3.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold leading-none transition ${
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
