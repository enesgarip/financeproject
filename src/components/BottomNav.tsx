import { Banknote, CreditCard, HandCoins, Home, Landmark, WalletCards } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Özet', icon: Home },
  { to: '/varliklar', label: 'Varlık', icon: Banknote },
  { to: '/kartlar', label: 'Kart', icon: CreditCard },
  { to: '/krediler', label: 'Kredi', icon: Landmark },
  { to: '/borclar', label: 'Borç', icon: HandCoins },
  { to: '/odemeler', label: 'Ödeme', icon: WalletCards },
]

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-xl grid-cols-6">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-medium ${
                isActive ? 'text-emerald-700' : 'text-stone-500'
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
