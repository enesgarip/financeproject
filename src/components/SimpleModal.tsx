import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from './ui/use-body-scroll-lock'

type SimpleModalProps = {
  title: string
  open: boolean
  children: React.ReactNode
  onClose: () => void
}

export function SimpleModal({ title, open, children, onClose }: SimpleModalProps) {
  useBodyScrollLock(open)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/56 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-md sm:items-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-modal-title"
        className="max-h-[88svh] w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border/85 bg-card text-card-foreground shadow-[var(--shadow-elevated)] sm:max-h-[92svh] sm:max-w-2xl"
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
