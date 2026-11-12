import { useId, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { useBodyScrollLock } from './ui/use-body-scroll-lock'
import { useDialogA11y } from './ui/use-dialog-a11y'

type SimpleModalProps = {
  title: string
  open: boolean
  children: ReactNode
  pinnedContent?: ReactNode
  footer?: ReactNode
  scrollRef?: Ref<HTMLDivElement>
  scrollClassName?: string
  onClose: () => void
  busy?: boolean
}

export function SimpleModal({ title, open, children, pinnedContent, footer, scrollRef, scrollClassName, onClose, busy = false }: SimpleModalProps) {
  const titleId = useId()
  const splitScroll = Boolean(pinnedContent || footer)
  useBodyScrollLock(open)
  // Focus sözleşmesi (odak içeri, Tab hapsi, Escape, kapanışta geri verme) ortak
  // hook'ta — aynı davranış ConfirmDialog ve import modallarında da kullanılıyor.
  const requestClose = () => { if (!busy) onClose() }
  const sectionRef = useDialogA11y<HTMLElement>(open, requestClose)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center overflow-y-auto bg-[var(--overlay)] backdrop-blur-md sm:items-center sm:p-6">
      <section
        ref={sectionRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        data-navigation-busy={busy || undefined}
        aria-labelledby={titleId}
        className={cn(
          'motion-panel max-h-[88dvh] w-full min-w-0 rounded-t-2xl border border-line-strong bg-raised text-ink focus:outline-none sm:max-h-[92dvh] sm:max-w-2xl sm:rounded-2xl',
          splitScroll ? 'flex flex-col overflow-hidden' : 'overflow-x-hidden overflow-y-auto',
        )}
      >
        <header className="sticky top-0 z-10 shrink-0 border-b border-line-strong bg-raised/94 px-4 py-3 backdrop-blur">
          {/* Mobilde biçim bottom-sheet: tutamak biçimin kendisini anlatır,
              kapatma butonu tek çıkış yolu gibi durmasın. */}
          <span aria-hidden="true" className="mx-auto mb-2.5 block h-1 w-9 rounded-full bg-line-strong sm:hidden" />
          <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="min-w-0 break-words text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="interaction-press grid size-11 shrink-0 place-items-center rounded-lg border border-line-strong bg-page text-ink-muted hover:bg-primary/8 hover:text-ink"
            aria-label="Kapat"
          >
            <X size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          </div>
        </header>
        {pinnedContent ? <div className="shrink-0 border-b border-line px-4 py-3">{pinnedContent}</div> : null}
        <div ref={scrollRef} className={cn(
          'min-w-0 bg-raised px-4 pt-4',
          footer ? 'pb-4' : 'pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:pb-5',
          splitScroll && 'min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain scroll-py-3',
          scrollClassName,
        )}>
          {children}
        </div>
        {footer ? <footer className="shrink-0 border-t border-line bg-raised px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-3">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  )
}
