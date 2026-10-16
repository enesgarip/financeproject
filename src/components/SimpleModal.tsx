import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from './ui/use-body-scroll-lock'
import { useDialogA11y } from './ui/use-dialog-a11y'

type SimpleModalProps = {
  title: string
  open: boolean
  children: React.ReactNode
  onClose: () => void
}

export function SimpleModal({ title, open, children, onClose }: SimpleModalProps) {
  useBodyScrollLock(open)
  // Focus sözleşmesi (odak içeri, Tab hapsi, Escape, kapanışta geri verme) ortak
  // hook'ta — aynı davranış ConfirmDialog ve import modallarında da kullanılıyor.
  const sectionRef = useDialogA11y<HTMLElement>(open, onClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-[var(--overlay)] backdrop-blur-md sm:items-center sm:p-6">
      <section
        ref={sectionRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="simple-modal-title"
        className="motion-panel max-h-[88dvh] w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-t-2xl border border-line-strong bg-raised text-ink focus:outline-none sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-line-strong bg-raised/94 px-4 py-3 backdrop-blur">
          {/* Mobilde biçim bottom-sheet: tutamak biçimin kendisini anlatır,
              kapatma butonu tek çıkış yolu gibi durmasın. */}
          <span aria-hidden="true" className="mx-auto mb-2.5 block h-1 w-9 rounded-full bg-line-strong sm:hidden" />
          <div className="flex items-center justify-between gap-3">
          <h2 id="simple-modal-title" className="min-w-0 break-words text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="interaction-press grid size-11 place-items-center rounded-lg border border-line-strong bg-page text-ink-muted hover:bg-primary/8 hover:text-ink"
            aria-label="Kapat"
          >
            <X size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          </div>
        </header>
        <div className="min-w-0 bg-raised px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 sm:pb-5">
          {children}
        </div>
      </section>
    </div>,
    document.body,
  )
}
