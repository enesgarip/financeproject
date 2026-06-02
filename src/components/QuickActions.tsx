import { ArrowRightLeft, Banknote, HandCoins, Landmark, Plus, ReceiptText, Search, WalletCards, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { Input } from './ui/input'

const actions = [
  { to: '/kartlar#hizli-harcama', matchPath: '/kartlar', label: 'Harcama', description: 'Hesaptan veya karttan harca', icon: WalletCards },
  { to: '/kartlar#hesap-merkezi', matchPath: '/kartlar', label: 'Transfer', description: 'Hesaptan hesaba aktar', icon: ArrowRightLeft },
  { to: '/odemeler?new=1', matchPath: '/odemeler', label: 'Planlı', description: 'Fatura, kira veya abonelik', icon: ReceiptText },
  { to: '/borclar?new=1', matchPath: '/borclar', label: 'Kişi', description: 'Borç veya alacak kaydı', icon: HandCoins },
  { to: '/varliklar?new=1', matchPath: '/varliklar', label: 'Varlık', description: 'Nakit, yatırım veya maaş', icon: Banknote },
  { to: '/krediler?new=1', matchPath: '/krediler', label: 'Kredi', description: 'Kredi ve taksit planı', icon: Landmark },
]

const routePriorities: Record<string, string> = {
  '/kartlar': '/kartlar',
  '/odemeler': '/odemeler',
  '/borclar': '/borclar',
  '/varliklar': '/varliklar',
  '/krediler': '/krediler',
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
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] right-4 z-40 flex flex-col items-end gap-3 lg:bottom-6 lg:right-6">
      {open ? (
        <div className="w-[min(calc(100vw-2rem),23rem)] rounded-lg border border-border/80 bg-card/96 p-2 shadow-[var(--shadow-elevated)] backdrop-blur-xl">
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hızlı işlem ara"
              className="pl-9 text-sm"
            />
          </label>
          {orderedActions.map((action) => (
            <Link
              key={action.to + action.label}
              to={action.to}
              onClick={() => setOpenPath(null)}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-muted',
                action.matchPath === preferredAction && 'bg-primary/10',
              )}
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <action.icon size={17} />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-foreground">{action.label}</p>
                <p className="truncate text-xs text-muted-foreground">{action.description}</p>
              </div>
            </Link>
          ))}
          {orderedActions.length === 0 ? <p className="px-3 py-4 text-center text-sm text-muted-foreground">Eşleşen hızlı işlem yok.</p> : null}
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
        className={cn(
          'grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/25 ring-1 ring-white/25 transition hover:bg-primary/90',
          tucked && 'pointer-events-none translate-y-3 scale-90 opacity-0 sm:pointer-events-auto sm:translate-y-0 sm:scale-100 sm:opacity-100',
        )}
      >
        {open ? <X size={24} /> : <Plus size={26} />}
      </button>
    </div>
  )
}
