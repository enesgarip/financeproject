/** Shown by the top-level AppErrorBoundary when the app crashes. */
export function ErrorFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Bir şeyler ters gitti</h1>
      <p className="text-sm text-ink-muted">
        Beklenmeyen bir hata oluştu. Sayfayı yenilemeyi deneyin.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Sayfayı yenile
      </button>
    </div>
  )
}
