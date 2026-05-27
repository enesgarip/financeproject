import { Banknote, HandCoins, Landmark, Plus, ReceiptText, Search, ShieldCheck, WalletCards, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const actions = [
  { to: '/kartlar#hizli-harcama', matchPath: '/kartlar', label: 'Harcama', description: 'Kartlar ekranında hızlı harcama', icon: WalletCards },
  { to: '/odemeler?new=1', matchPath: '/odemeler', label: 'Ödeme', description: 'Fatura, kira veya abonelik', icon: ReceiptText },
  { to: '/borclar?new=1', matchPath: '/borclar', label: 'Borç', description: 'Borç veya alacak kaydı', icon: HandCoins },
  { to: '/varliklar?new=1', matchPath: '/varliklar', label: 'Varlık', description: 'Nakit, yatırım veya maaş', icon: Banknote },
  { to: '/krediler?new=1', matchPath: '/krediler', label: 'Kredi', description: 'Kredi ve taksit planı', icon: Landmark },
  { to: '/veri-sagligi', matchPath: '/veri-sagligi', label: 'Kontrol', description: 'Veri sağlığı ve güvenli düzeltmeler', icon: ShieldCheck },
]

const routePriorities: Record<string, string> = {
  '/kartlar': '/kartlar',
  '/odemeler': '/odemeler',
  '/borclar': '/borclar',
  '/varliklar': '/varliklar',
  '/krediler': '/krediler',
  '/veri-sagligi': '/veri-sagligi',
  '/analiz': '/veri-sagligi',
}

function isFormElementActive() {
  if (typeof document === 'undefined') return false
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

export function QuickActions() {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [formFocused, setFormFocused] = useState(false)
  const location = useLocation()
  const open = openPath === location.pathname
  const preferredAction = routePriorities[location.pathname] ?? routePriorities[`/${location.pathname.split('/')[1]}`]
  const orderedActions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
    const filteredActions = normalizedQuery
      ? actions.filter((action) => `${action.label} ${action.description}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
      : actions
    if (!preferredAction) return filteredActions
    return [...filteredActions].sort((left, right) => Number(right.matchPath === preferredAction) - Number(left.matchPath === preferredAction))
  }, [preferredAction, query])
  const tucked = formFocused && !open

  useEffect(() => {
    const syncFocus = () => setFormFocused(isFormElementActive())
    const syncFocusAfterBlur = () => window.setTimeout(syncFocus, 0)

    syncFocus()
    document.addEventListener('focusin', syncFocus)
    document.addEventListener('focusout', syncFocusAfterBlur)
    return () => {
      document.removeEventListener('focusin', syncFocus)
      document.removeEventListener('focusout', syncFocusAfterBlur)
    }
  }, [])

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.15rem)] right-4 z-40 flex flex-col items-end gap-3">
      {open ? (
        <div className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl border border-stone-200 bg-white p-2 shadow-2xl shadow-stone-950/15 dark:border-stone-800 dark:bg-stone-950 dark:shadow-black/40">
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="İşlem ara"
              className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-9 pr-3 text-sm font-semibold outline-none focus:border-emerald-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
            />
          </label>
          {orderedActions.map((action) => (
            <Link
              key={action.to + action.label}
              to={action.to}
              onClick={() => setOpenPath(null)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-stone-100 dark:hover:bg-stone-900 ${
                action.matchPath === preferredAction ? 'bg-emerald-50/80 dark:bg-emerald-950/25' : ''
              }`}
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
          {orderedActions.length === 0 ? <p className="px-3 py-4 text-center text-sm text-stone-500">Eşleşen hızlı işlem yok.</p> : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setQuery('')
          setOpenPath((current) => (current === location.pathname ? null : location.pathname))
        }}
        aria-expanded={open}
        aria-label={open ? 'Hızlı işlem menüsünü kapat' : 'Hızlı işlem menüsünü aç'}
        className={`grid size-14 place-items-center rounded-full bg-emerald-700 text-white shadow-xl shadow-emerald-900/25 ring-1 ring-white/25 transition hover:bg-emerald-800 ${
          tucked ? 'pointer-events-none translate-y-3 scale-90 opacity-0 sm:pointer-events-auto sm:translate-y-0 sm:scale-100 sm:opacity-100' : ''
        }`}
      >
        {open ? <X size={24} /> : <Plus size={26} />}
      </button>
    </div>
  )
}
