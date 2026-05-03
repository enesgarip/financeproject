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
    <div className="fixed inset-0 z-40 flex items-end bg-black/40 px-3 pb-3 sm:items-center sm:justify-center sm:p-6">
      <section className="max-h-[90svh] w-full overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-stone-950 sm:max-w-lg">
        <header className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-950">
          <h2 className="text-base font-semibold text-stone-950 dark:text-stone-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-full text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-900"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </section>
    </div>
  )
}
