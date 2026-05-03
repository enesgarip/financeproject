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
    <div className="fixed inset-0 z-40 flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-6">
      <section className="max-h-[92svh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-stone-950 sm:max-w-lg sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-950">
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
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:pb-4">{children}</div>
      </section>
    </div>
  )
}
