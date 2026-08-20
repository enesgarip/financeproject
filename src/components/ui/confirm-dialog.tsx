import { createPortal } from "react-dom"
import { AlertTriangle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBodyScrollLock } from "./use-body-scroll-lock"
import { useDialogA11y } from "./use-dialog-a11y"

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
  useBodyScrollLock(open)
  // Ortak focus sözleşmesi (SimpleModal ile aynı hook): odak diyaloğa taşınır,
  // Tab içeride hapsedilir, Escape kapatır ve kapanınca odak TETİKLEYİCİYE döner.
  // Eskiden geri verme yoktu (odak <body>'ye düşüyordu) ve focusable listesi
  // açılışta bir kez alınıyordu — `loading` butonları disabled edince Tab döngüsü
  // ölü referanslara kuruluyordu (denetim 2026-08-12 §6).
  const sectionRef = useDialogA11y<HTMLElement>(open, onCancel)

  if (!open) return null

  const isDestructive = variant === "destructive"

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end bg-[var(--overlay)] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section
        ref={sectionRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md overflow-hidden rounded-lg border border-line-strong bg-raised text-ink focus:outline-none"
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
            <h2 id="confirm-dialog-title" className="text-base font-extrabold leading-snug text-ink">
              {title}
            </h2>
            <p id="confirm-dialog-description" className="mt-1 text-sm leading-6 text-ink-muted">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-black/[.03] dark:hover:bg-white/[.04] hover:text-ink disabled:opacity-50"
            aria-label="Kapat"
          >
            <X size={17} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line-strong bg-page p-3">
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
