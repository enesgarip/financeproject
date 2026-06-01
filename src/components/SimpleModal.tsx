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
    <div className="fixed inset-0 z-40 flex items-end bg-black/45 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section className="max-h-[92svh] w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-t-lg border border-border/80 bg-card shadow-xl dark:shadow-black/40 sm:max-w-lg sm:rounded-lg">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border/80 bg-card/95 px-4 py-3 backdrop-blur">
          <h2 className="text-base font-black text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-w-0 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:pb-4">{children}</div>
      </section>
    </div>
  )
}
