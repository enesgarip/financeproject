import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Veri yüklenemediğinde gösterilen ortak hata bloğu: `role="alert"` + "Tekrar dene".
 *
 * Neden ortak: Dashboard bunu doğru yapıyordu (alert rolü + retry), Analiz /
 * Planlama / Alsam mı? ekranları ise ya çıplak bir `<p>` basıyor ya da hiç hata
 * göstermeyip SIFIRLARLA "her şey normal" görünüyordu (denetim 2026-08-12 §6).
 * Dashboard'daki kopya kendi düzenine gömülü kaldı; buradaki sürüm Şerit
 * ekranlarının tamamının tek kaynağı.
 */
export function QueryError({
  title,
  message,
  onRetry,
  retrying = false,
}: {
  title: string
  message?: string
  onRetry?: () => void
  /** true iken buton "Yenileniyor" der ve kilitlenir (çift istek olmasın). */
  retrying?: boolean
}) {
  return (
    <section
      role="alert"
      aria-live="assertive"
      className="rounded-2xl border border-destructive/20 bg-destructive/8 p-4 text-sm text-destructive"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-black text-destructive">{title}</h2>
            {message ? <p className="mt-1 leading-6 text-destructive/85">{message}</p> : null}
          </div>
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/25 bg-raised px-4 text-sm font-black text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retrying ? 'Yenileniyor' : 'Tekrar dene'}
          </button>
        ) : null}
      </div>
    </section>
  )
}
