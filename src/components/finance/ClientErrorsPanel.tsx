/**
 * İstemci hata kayıtları paneli (/veri-sagligi/islemler) — Sentry'siz izlemenin
 * okuma yüzü. Yazan taraf lib/errorReport (AppErrorBoundary + window
 * dinleyicileri); burada son 7 günün kayıtları listelenir ve temizlenir.
 * Kayıt yoksa panel tek satırlık "temiz" durumuna küçülür.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bug, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { clearClientErrors, fetchRecentClientErrors } from '../../data/repositories/clientErrorsRepo'
import type { ClientErrorSource } from '../../types/database'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'

const CLIENT_ERRORS_QUERY_KEY = ['client-errors'] as const

const SOURCE_LABELS: Record<ClientErrorSource, string> = {
  boundary: 'Çökme (boundary)',
  error: 'Yakalanmamış hata',
  unhandledrejection: 'Promise reddi',
}

export function ClientErrorsPanel() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState('')

  const query = useQuery({
    queryKey: [...CLIENT_ERRORS_QUERY_KEY, user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const result = await fetchRecentClientErrors()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
  })
  const rows = query.data ?? []

  async function handleClear() {
    if (clearing) return
    setClearing(true)
    setClearError('')
    const result = await clearClientErrors()
    setClearing(false)
    if (!result.ok) {
      setClearError(result.error.message ?? 'Temizlenemedi.')
      return
    }
    void qc.invalidateQueries({ queryKey: CLIENT_ERRORS_QUERY_KEY })
  }

  return (
    <SurfaceCard>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bug className="size-4 text-primary" />
              İstemci hataları
            </CardTitle>
            <p className="mt-1 text-xs text-ink-muted">
              Son 7 gün · uygulama içi çökme ve yakalanmamış hatalar (Sentry'siz izleme).
            </p>
          </div>
          {rows.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={clearing}
              className="tap-target inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 size={14} />
              Temizle
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        {query.isError ? (
          <p className="text-sm text-ink-muted">Kayıtlar yüklenemedi (tablo migration'ı henüz canlı olmayabilir).</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">Son 7 günde kayıtlı istemci hatası yok.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl bg-page px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-destructive">{SOURCE_LABELS[row.source]}</span>
                  <span className="shrink-0 text-ink-muted">
                    {new Date(row.created_at).toLocaleString('tr-TR')}
                    {row.commit_sha ? ` · ${row.commit_sha.slice(0, 7)}` : ''}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm text-ink">{row.message}</p>
                {row.route ? <p className="mt-0.5 text-[11px] text-ink-faint">{row.route}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {clearError ? <p className="mt-2 text-xs text-destructive">{clearError}</p> : null}
      </CardContent>
    </SurfaceCard>
  )
}
