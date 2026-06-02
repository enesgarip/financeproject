import { X } from 'lucide-react'

type SimpleModalProps = {
  title: string
  open: boolean
  children: React.ReactNode
  onClose: () => void
}

export function SimpleModal({ title, open, children, onClose }: SimpleModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-950/50 px-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-modal-title"
        className="max-h-[92svh] w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-t-lg border border-border/85 bg-card text-card-foreground shadow-[var(--shadow-elevated)] sm:max-w-2xl sm:rounded-lg"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/80 bg-card/95 px-4 py-3 backdrop-blur">
          <h2 id="simple-modal-title" className="min-w-0 truncate text-base font-black text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:pb-5">{children}</div>
      </section>
    </div>
  )
}
