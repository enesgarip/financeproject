import { ArrowRightLeft, Banknote, HandCoins, Landmark, Plus, ReceiptText, Search, WalletCards, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { normalizeSearchText } from '../utils/searchText'
import { Input } from './ui/input'

const actions = [
  { to: '/kartlar?section=islemler#hizli-harcama', label: 'Harcama', description: 'Hesaptan veya karttan harca', icon: WalletCards, hiddenOnPaths: ['/kartlar'] },
  { to: '/kartlar#hesap-merkezi', label: 'Transfer', description: 'Hesaptan hesaba aktar', icon: ArrowRightLeft, hiddenOnPaths: ['/kartlar'] },
  { to: '/odemeler?new=1', label: 'Planlı', description: 'Fatura, kira veya abonelik', icon: ReceiptText, hiddenOnPaths: ['/odemeler'] },
  { to: '/borclar/kisiler?new=1', label: 'Kişi', description: 'Borç veya alacak kaydı', icon: HandCoins, hiddenOnPaths: ['/borclar'] },
  { to: '/varliklar?new=1', label: 'Varlık', description: 'Nakit, yatırım veya maaş', icon: Banknote, hiddenOnPaths: ['/varliklar'] },
  { to: '/borclar/krediler?new=1', label: 'Kredi', description: 'Kredi ve taksit planı', icon: Landmark, hiddenOnPaths: ['/borclar'] },
]

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
  const [scrolled, setScrolled] = useState(false)
  const lastScrollY = useRef(0)
  const location = useLocation()
  const open = openPath === location.pathname
  const currentRootPath = location.pathname === '/' ? '/' : `/${location.pathname.split('/')[1]}`
  const orderedActions = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)
    const availableActions = actions.filter((action) => !action.hiddenOnPaths.includes(currentRootPath))
    return normalizedQuery
      ? availableActions.filter((action) => normalizeSearchText(`${action.label} ${action.description}`).includes(normalizedQuery))
      : availableActions
  }, [currentRootPath, query])
  const tucked = formFocused && !open

  const handleScroll = useCallback(() => {
    const y = window.scrollY
    setScrolled(y > 100 && y > lastScrollY.current)
    lastScrollY.current = y
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

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
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.45rem)] right-4 z-40 flex flex-col items-end gap-3 lg:bottom-6 lg:right-6">
      {open ? (
        <div className="finance-command-surface w-[min(calc(100vw-2rem),24rem)] rounded-lg p-2">
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
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-muted"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <action.icon size={17} />
              </div>
              <div className="min-w-0">
                <p className="font-black text-foreground">{action.label}</p>
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
          'group flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 ring-1 ring-white/25 transition-all duration-200 hover:bg-primary/90',
          open ? 'size-14 justify-center' : scrolled ? 'size-12 justify-center' : 'h-14 pl-5 pr-4',
          tucked && 'pointer-events-none translate-y-3 scale-90 opacity-0 sm:pointer-events-auto sm:translate-y-0 sm:scale-100 sm:opacity-100',
        )}
      >
        {open ? (
          <X size={24} />
        ) : (
          <>
            <Plus size={scrolled ? 20 : 22} strokeWidth={2.5} />
            {scrolled ? null : <span className="text-sm font-bold">İşlem</span>}
          </>
        )}
      </button>
    </div>
  )
}
