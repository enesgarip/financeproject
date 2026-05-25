import { Banknote, HandCoins, Landmark, Plus, ReceiptText, ShieldCheck, WalletCards, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

const actions = [
  { to: '/kartlar', label: 'Harcama', description: 'Kartlar ekranında hızlı harcama', icon: WalletCards },
  { to: '/odemeler', label: 'Ödeme', description: 'Fatura, kira veya abonelik', icon: ReceiptText },
  { to: '/borclar', label: 'Borç', description: 'Borç veya alacak kaydı', icon: HandCoins },
  { to: '/varliklar', label: 'Varlık', description: 'Nakit, yatırım veya maaş', icon: Banknote },
  { to: '/krediler', label: 'Kredi', description: 'Kredi ve taksit planı', icon: Landmark },
  { to: '/veri-sagligi', label: 'Kontrol', description: 'Veri sağlığı ve güvenli düzeltmeler', icon: ShieldCheck },
]

export function QuickActions() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.15rem)] right-4 z-40 flex flex-col items-end gap-3">
      {open ? (
        <div className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl border border-stone-200 bg-white p-2 shadow-2xl shadow-stone-950/15 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/40">
          {actions.map((action) => (
            <Link
              key={action.to + action.label}
              to={action.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-stone-100 dark:hover:bg-stone-900"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">
                <action.icon size={17} />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-stone-950 dark:text-stone-50">{action.label}</p>
                <p className="truncate text-xs text-stone-500 dark:text-stone-400">{action.description}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? 'Hızlı işlem menüsünü kapat' : 'Hızlı işlem menüsünü aç'}
        className="grid size-14 place-items-center rounded-full bg-emerald-700 text-white shadow-xl shadow-emerald-900/25 ring-1 ring-white/25 transition hover:bg-emerald-800"
      >
        {open ? <X size={24} /> : <Plus size={26} />}
      </button>
    </div>
  )
}
