import { AlertCircle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'warning' | 'info'

type Toast = {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number
}

type ToastContextValue = {
  toast: (opts: Omit<Toast, 'id'>) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const toastStyles: Record<ToastType, { wrapper: string; icon: ReactNode }> = {
  success: {
    wrapper: 'border-success/25 bg-card text-foreground dark:border-success/30',
    icon: <CheckCircle2 className="size-4 text-success" />,
  },
  error: {
    wrapper: 'border-destructive/25 bg-card text-foreground dark:border-destructive/30',
    icon: <XCircle className="size-4 text-destructive" />,
  },
  warning: {
    wrapper: 'border-warning/25 bg-card text-foreground dark:border-warning/30',
    icon: <AlertCircle className="size-4 text-warning" />,
  },
  info: {
    wrapper: 'border-info/25 bg-card text-foreground dark:border-info/30',
    icon: <Info className="size-4 text-info" />,
  },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { wrapper, icon } = toastStyles[toast.type]

  const dismiss = useCallback(() => {
    setLeaving(true)
    setTimeout(() => onDismiss(toast.id), 300)
  }, [onDismiss, toast.id])

  useEffect(() => {
    // Enter animation
    const enterTimer = setTimeout(() => setVisible(true), 16)
    return () => clearTimeout(enterTimer)
  }, [])

  useEffect(() => {
    const duration = toast.duration ?? 4500
    timerRef.current = setTimeout(() => dismiss(), duration)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [dismiss, toast.duration])

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border px-4 py-3.5',
        'shadow-[var(--shadow-floating)] backdrop-blur-xl',
        'transition-all duration-300',
        wrapper,
        visible && !leaving
          ? 'translate-x-0 opacity-100'
          : 'translate-x-6 opacity-0',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="mt-0.5 shrink-0 rounded-lg p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        aria-label="Bildirimi kapat"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts((prev) => [...prev.slice(-4), { ...opts, id }])
  }, [])

  const ctx: ToastContextValue = useMemo(() => ({
    toast: addToast,
    success: (title: string, description?: string) => addToast({ type: 'success', title, description }),
    error:   (title: string, description?: string) => addToast({ type: 'error',   title, description }),
    warning: (title: string, description?: string) => addToast({ type: 'warning', title, description }),
    info:    (title: string, description?: string) => addToast({ type: 'info',    title, description }),
  }), [addToast])

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {/* Portal: top-right toast stack */}
      <div
        aria-label="Bildirimler"
        className="pointer-events-none fixed right-4 top-4 z-[9999] flex flex-col gap-2 sm:right-6 sm:top-6"
        style={{ width: 'min(calc(100vw - 2rem), 24rem)' }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
