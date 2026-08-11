import { ArrowRightLeft, Banknote, HandCoins, Landmark, Plus, ReceiptText, Search, ShoppingCart, WalletCards, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { normalizeSearchText } from '../utils/searchText'
import { Input } from './ui/input'

/**
 * Hızlı işlem akışı. Panel ile TETİKLEYİCİ kasıtlı olarak ayrı bileşenler:
 * Şerit'te FAB artık serbest yüzen bir öğe değil, alt barın kendi 76px'lik
 * ayrılmış bandında oturuyor (`QuickActionsFab`), masaüstünde ise başlık
 * satırındaki "İşlem" butonu (`QuickActionsButton`). İkisi de aynı paneli açar.
 *
 * Eski hâlinde FAB `fixed` olarak içeriğin üstünde yüzüyordu ve sayfa sonunda
 * satırları örtüyordu — tasarımın açıkça düzelttiği hata buydu.
 */

const actions = [
  { to: '/odemeler/alsam-mi', label: 'Alsam mı?', description: 'Alışverişin aylara etkisini gör', icon: ShoppingCart, hiddenOnPaths: ['/odemeler'] },
  { to: '/kartlar?section=islemler#hizli-harcama', label: 'Harcama', description: 'Hesaptan veya karttan harca', icon: WalletCards, hiddenOnPaths: ['/kartlar'] },
  { to: '/kartlar#hesap-merkezi', label: 'Transfer', description: 'Hesaptan hesaba aktar', icon: ArrowRightLeft, hiddenOnPaths: ['/kartlar'] },
  { to: '/odemeler?new=1', label: 'Planlı', description: 'Fatura, kira veya abonelik', icon: ReceiptText, hiddenOnPaths: ['/odemeler'] },
  { to: '/borclar/kisiler?new=1', label: 'Kişi', description: 'Borç veya alacak kaydı', icon: HandCoins, hiddenOnPaths: ['/borclar'] },
  { to: '/varliklar?new=1', label: 'Varlık', description: 'Nakit, yatırım veya maaş', icon: Banknote, hiddenOnPaths: ['/varliklar'] },
  { to: '/borclar/krediler?new=1', label: 'Kredi', description: 'Kredi ve taksit planı', icon: Landmark, hiddenOnPaths: ['/borclar'] },
]

type QuickActionsContextValue = {
  open: boolean
  toggle: () => void
  close: () => void
  /** Form alanına odaklanınca mobil FAB geri çekilir (klavye üstünde durmasın). */
  tucked: boolean
}

const QuickActionsContext = createContext<QuickActionsContextValue | null>(null)

function useQuickActions() {
  const ctx = useContext(QuickActionsContext)
  if (!ctx) throw new Error('QuickActions trigger must be used inside QuickActionsProvider')
  return ctx
}

function isFormElementActive() {
  if (typeof document === 'undefined') return false
  const element = document.activeElement
  if (!(element instanceof HTMLElement)) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  // Rota bazlı açıklık: sayfa değişince menü kendiliğinden kapanır.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [formFocused, setFormFocused] = useState(false)
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

  const close = useCallback(() => setOpenPath(null), [])
  const toggle = useCallback(() => {
    setQuery('')
    setOpenPath((current) => (current === location.pathname ? null : location.pathname))
  }, [location.pathname])

  const value = useMemo(
    () => ({ open, toggle, close, tucked: formFocused && !open }),
    [open, toggle, close, formFocused],
  )

  return (
    <QuickActionsContext.Provider value={value}>
      {children}

      {/* Menü açıkken hafif karartma + dışa tıklayınca kapat: odağı menüye topla
          ve tek çıkış yolu (X) olmasın. */}
      {open ? (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={close}
          className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[1px]"
        />
      ) : null}

      {open ? (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+9rem)] right-4 z-50 w-[min(calc(100vw-2rem),24rem)] rounded-[14px] border border-line-strong bg-raised p-2 lg:bottom-6 lg:right-6">
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
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
              onClick={close}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-[120ms] hover:bg-black/[.03] dark:hover:bg-white/[.04]"
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <action.icon size={17} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{action.label}</p>
                <p className="truncate text-xs text-ink-muted">{action.description}</p>
              </div>
            </Link>
          ))}
          {orderedActions.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-ink-muted">Eşleşen hızlı işlem yok.</p>
          ) : null}
        </div>
      ) : null}
    </QuickActionsContext.Provider>
  )
}

/** Mobil FAB — 52×52, yarıçap 16. Alt barın ayrılmış bandına yerleşir. */
export function QuickActionsFab() {
  const { open, toggle, tucked } = useQuickActions()

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-label={open ? 'Hızlı işlem menüsünü kapat' : 'Hızlı işlem menüsünü aç'}
      className={cn(
        'grid size-[52px] place-items-center rounded-[16px] bg-primary text-primary-foreground transition-all duration-200',
        'shadow-[0_12px_30px_color-mix(in_srgb,var(--primary)_28%,transparent)]',
        tucked && 'pointer-events-none translate-y-3 scale-90 opacity-0',
      )}
    >
      {open ? <X size={24} /> : <Plus size={24} strokeWidth={2.5} />}
    </button>
  )
}

/** Masaüstü başlık butonu — jade dolu "İşlem". */
export function QuickActionsButton() {
  const { open, toggle } = useQuickActions()

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground transition-colors duration-[120ms] hover:brightness-95"
    >
      {open ? <X size={15} aria-hidden="true" /> : <Plus size={15} strokeWidth={2.5} aria-hidden="true" />}
      İşlem
    </button>
  )
}
