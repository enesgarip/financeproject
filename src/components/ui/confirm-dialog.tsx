import { useEffect } from "react"
import { AlertTriangle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
  // Dialog açıkken arka plan sayfasının kaymasını engelle.
  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  if (!open) return null

  const isDestructive = variant === "destructive"

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section
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
    </div>
  )
}

export { ConfirmDialog }
