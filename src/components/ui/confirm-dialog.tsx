import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBodyScrollLock } from "./use-body-scroll-lock"

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "destructive" | "default"
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const sectionRef = useRef<HTMLElement>(null)
  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return
    const section = sectionRef.current
    if (!section) return

    const focusable = section.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    first?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key === 'Tab' && focusable.length > 0) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const isDestructive = variant === "destructive"

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end bg-slate-950/45 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section
        ref={sectionRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md overflow-hidden rounded-lg border border-border/85 bg-card text-card-foreground shadow-[var(--shadow-elevated)]"
      >
        <div className="flex items-start gap-3 p-4">
          <div
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-lg",
              isDestructive
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            <AlertTriangle size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-base font-extrabold leading-snug text-foreground">
              {title}
            </h2>
            <p id="confirm-dialog-description" className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Kapat"
          >
            <X size={17} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border/75 bg-muted/35 p-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={isDestructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "İşleniyor..." : confirmLabel}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export { ConfirmDialog }
