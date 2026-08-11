import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from './ui/use-body-scroll-lock'

type SimpleModalProps = {
  title: string
  open: boolean
  children: React.ReactNode
  onClose: () => void
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SimpleModal({ title, open, children, onClose }: SimpleModalProps) {
  const sectionRef = useRef<HTMLElement>(null)
  useBodyScrollLock(open)

  // onClose'u ref'te tut: effect yalnız `open` değişince kurulmalı. Aksi halde
  // çağıran inline `onClose={() => ...}` verdiğinde (her render'da yeni referans)
  // effect her tuş vuruşunda yeniden kurulur, `section.focus()` odağı input'tan
  // alır ve MOBİLDE KLAVYE KAPANIR (yazarken en sinir bozucu bug).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // A11y: focus'u modala taşı, arka plana kaçmayı engelle (Tab döngüsü), Escape ile
  // kapat ve kapanınca focus'u tetikleyen öğeye geri ver. Aynı desen confirm-dialog'da
  // da var; burada içerik form olduğu için focusable listesi HER Tab'da yeniden
  // sorgulanır (hata mesajı/alan görünüp kaybolabilir).
  useEffect(() => {
    if (!open) return
    const section = sectionRef.current
    if (!section) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    section.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(section!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) {
        event.preventDefault()
        section!.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === section)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/56 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-md sm:items-center sm:p-6">
      <section
        ref={sectionRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-modal-title"
        className="max-h-[88svh] w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border/85 bg-card text-card-foreground focus:outline-none sm:max-h-[92svh] sm:max-w-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/80 bg-card/94 px-4 py-3 backdrop-blur">
          <h2 id="simple-modal-title" className="min-w-0 truncate text-base font-black text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-lg border border-border/75 bg-background/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-w-0 bg-[linear-gradient(180deg,var(--card),color-mix(in_srgb,var(--surface-muted)_70%,var(--card)_30%))] px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:pb-5">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  )
}
