import { ArrowRightLeft, Banknote, HandCoins, Landmark, MoreHorizontal, Plus, ReceiptText, ShoppingCart, WalletCards, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useBodyScrollLock } from './ui/use-body-scroll-lock'
import { useDialogA11y } from './ui/use-dialog-a11y'

export const quickExpensePath = '/kartlar?section=kartlar&panel=manuel'
const actions = [
  { to: quickExpensePath, label: 'Harcama ekle', description: 'Hesap veya kart harcamasını kaydet', icon: WalletCards },
  { to: '/kartlar#hesap-merkezi', label: 'Transfer kaydet', description: 'Hesaplar arası para aktarımını kaydet', icon: ArrowRightLeft },
  { to: '/odemeler?new=1', label: 'Ödeme planla', description: 'Fatura, kira veya abonelik', icon: ReceiptText },
  { to: '/odemeler/alsam-mi', label: 'Alsam mı?', description: 'Alışverişin aylara etkisini gör', icon: ShoppingCart },
  { to: '/borclar/kisiler?new=1', label: 'Borç / alacak ekle', description: 'Kişisel borç veya alacak kaydı', icon: HandCoins },
  { to: '/varliklar?new=1', label: 'Varlık ekle', description: 'Nakit veya yatırım kaydı', icon: Banknote },
  { to: '/borclar/krediler?new=1', label: 'Kredi ekle', description: 'Kredi ve taksit planı', icon: Landmark },
]

type QuickActionsContextValue = { open: boolean; toggle: () => void; close: () => void; tucked: boolean }
const QuickActionsContext = createContext<QuickActionsContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components -- Kabuk aynı sağlayıcı durumunu kullanır.
export function useQuickActions() {
  const ctx = useContext(QuickActionsContext)
  if (!ctx) throw new Error('QuickActions trigger must be used inside QuickActionsProvider')
  return ctx
}

function ActionLink({ action, onSelect }: { action: typeof actions[number]; onSelect: () => void }) {
  return (
    <Link to={action.to} onClick={onSelect} className="interaction-press flex min-h-16 items-center gap-3 rounded-xl px-3 py-3 hover:bg-primary/8">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><action.icon size={20} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-ink">{action.label}</span><span className="mt-0.5 block text-[13px] text-ink-muted">{action.description}</span></span>
    </Link>
  )
}

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [formFocused, setFormFocused] = useState(false)
  const location = useLocation()
  const open = openPath === location.pathname
  useEffect(() => {
    const syncFocus = () => setFormFocused(Boolean(document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')))
    let blurTimer = 0
    const syncBlur = () => { blurTimer = window.setTimeout(syncFocus, 0) }
    syncFocus()
    document.addEventListener('focusin', syncFocus)
    document.addEventListener('focusout', syncBlur)
    return () => {
      window.clearTimeout(blurTimer)
      document.removeEventListener('focusin', syncFocus)
      document.removeEventListener('focusout', syncBlur)
    }
  }, [location.key])
  const close = useCallback(() => setOpenPath(null), [])
  const toggle = useCallback(() => setOpenPath(current => current === location.pathname ? null : location.pathname), [location.pathname])
  const value = useMemo(() => ({ open, toggle, close, tucked: formFocused && !open }), [open, toggle, close, formFocused])
  const panelRef = useDialogA11y<HTMLDivElement>(open, close)
  useBodyScrollLock(open)
  return (
    <QuickActionsContext.Provider value={value}>
      {children}
      {open ? <>
        <button type="button" aria-hidden tabIndex={-1} onClick={close} className="fixed inset-0 z-40 cursor-default bg-[var(--overlay)]" />
        <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Hızlı işlem menüsü" className="motion-panel fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-line-strong bg-raised px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 focus:outline-none md:inset-x-auto md:bottom-6 md:right-6 md:w-96 md:rounded-2xl">
          <span aria-hidden className="mx-auto mb-2 block h-1 w-9 rounded-full bg-line-strong md:hidden" />
          <div className="flex items-center justify-between gap-3 px-3"><h2 className="text-base font-semibold">İşlemler</h2><button type="button" onClick={close} aria-label="İşlem menüsünü kapat" className="interaction-press grid size-11 place-items-center rounded-xl text-ink-muted hover:bg-primary/8"><X size={20} strokeWidth={1.8} aria-hidden="true" /></button></div>
          {actions.slice(0, 3).map(action => <ActionLink key={action.to} action={action} onSelect={close} />)}
          <details className="mt-2 border-t border-line"><summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-ink-muted">Diğer işlemler</summary>{actions.slice(3).map(action => <ActionLink key={action.to} action={action} onSelect={close} />)}</details>
        </div>
      </> : null}
    </QuickActionsContext.Provider>
  )
}

/** Eski FAB'ın yerine alt gezinmenin içindeki taşma düğmesi. */
export function QuickActionsFab() {
  const { open, toggle } = useQuickActions()
  return <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label={open ? 'Hızlı işlem menüsünü kapat' : 'Hızlı işlem menüsünü aç'} className="interaction-press grid size-11 shrink-0 place-items-center rounded-xl border border-line-strong text-primary">{open ? <X size={22} strokeWidth={1.8} aria-hidden="true" /> : <MoreHorizontal size={22} strokeWidth={1.8} aria-hidden="true" />}</button>
}

export function QuickActionsButton() {
  const { open, toggle } = useQuickActions()
  return <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" className="interaction-press inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{open ? <X size={18} strokeWidth={1.8} aria-hidden="true" /> : <Plus size={18} strokeWidth={1.8} aria-hidden="true" />}İşlem</button>
}
