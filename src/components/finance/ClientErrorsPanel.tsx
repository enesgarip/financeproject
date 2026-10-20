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
import type { ClientError, ClientErrorSource } from '../../types/database'
import { diagnosticText } from '../../lib/errorDiagnostics'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'

const CLIENT_ERRORS_QUERY_KEY = ['client-errors'] as const

const SOURCE_LABELS: Record<ClientErrorSource, string> = {
  boundary: 'Çökme (boundary)',
  error: 'Yakalanmamış hata',
  unhandledrejection: 'Promise reddi',
  resource: 'Kaynak yükleme hatası',
  security: 'Güvenlik politikası ihlali',
  network: 'Ağ isteği hatası',
}

function ErrorDetails({ row }: { row: ClientError }) {
  const [copyState, setCopyState] = useState('')
  // Eski kayıtlar da okunur; kopyalama ekran görüntüsüne gerek bırakmaz.
  const report = JSON.stringify({
    id: row.id, recorded_at: row.created_at, source: row.source,
    message: diagnosticText(row.message), route: row.route,
    release: row.commit_sha, fingerprint: row.fingerprint,
    user_agent: row.user_agent, stack: row.stack ? diagnosticText(row.stack, 8000) : null,
    diagnostics: row.diagnostics ?? null,
  }, null, 2)
  const context = row.diagnostics && typeof row.diagnostics === 'object' && !Array.isArray(row.diagnostics) ? row.diagnostics : null
  return <details className="mt-2 text-xs">
    <summary className="cursor-pointer py-2 font-semibold">Teşhis ayrıntıları</summary>
    {context?.opaque === true ? <p className="my-2 text-warning">Tarayıcı hata ayrıntılarını gizledi. Dosya ve hata izi alınamadı; tekrarında tarayıcı konsolu gerekebilir.</p> : null}
    {!context ? <p className="my-2 text-ink-muted">Eski kayıt: genişletilmiş teknik bağlam bulunmuyor.</p> : null}
    <button type="button" className="tap-target my-2 rounded-lg border border-line px-3 py-2" onClick={() => {
      void (async () => {
        try { await navigator.clipboard.writeText(report); setCopyState('Rapor kopyalandı.') }
        catch { setCopyState('Kopyalanamadı. Aşağıdaki raporu seçerek kopyalayabilirsin.') }
      })()
    }}>Teşhis raporunu kopyala</button>
    {copyState ? <p role="status" className="my-2 text-ink-muted">{copyState}</p> : null}
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-3 text-[11px]">{report}</pre>
  </details>
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
              Son 7 gün · en yeni 50 kayıt. Çökme, betik, kaynak, güvenlik ve ağ hataları.
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
                <p className="mt-1 break-words text-sm text-ink">{diagnosticText(row.message)}</p>
                {row.route ? <p className="mt-0.5 text-[11px] text-ink-faint">{row.route}</p> : null}
                <ErrorDetails row={row} />
              </li>
            ))}
          </ul>
        )}
        {clearError ? <p className="mt-2 text-xs text-destructive">{clearError}</p> : null}
      </CardContent>
    </SurfaceCard>
  )
}
