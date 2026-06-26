import { CheckCircle2, ChevronDown, MessageSquareText, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchSmsLog } from '../../data/repositories/smsLogRepo'
import type { SmsLog } from '../../types/database'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Alert } from '../ui/alert'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'

const TYPE_LABEL: Record<SmsLog['sms_type'], string> = {
  card_expense: 'Kart harcaması',
  account_movement: 'Hesap hareketi',
  unrecognized: 'Tanınamadı',
}

function formatLogDate(value: string) {
  return new Date(value).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** SMS otomasyonunun (parse-sms edge function) son işleme sonuçlarını gösterir. */
export function SmsLogPanel() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<SmsLog[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const result = await fetchSmsLog(20)
    if (!result.ok) {
      setError(
        isMissingSupabaseCapabilityError(result.error)
          ? missingSupabaseCapabilityMessage('SMS geçmişi altyapısı', result.error)
          : result.error.message,
      )
      return
    }
    setLogs(result.data)
  }, [])

  useEffect(() => {
    if (!open || logs !== null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [open, logs, load])

  const errorCount = logs?.filter((l) => l.status === 'error').length ?? 0

  return (
    <SurfaceCard variant="elevated" className="overflow-hidden">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquareText size={20} className="text-primary" />
            SMS otomasyonu geçmişi
            {errorCount > 0 ? (
              <span className="rounded-full bg-destructive/12 px-2 py-0.5 text-xs font-semibold text-destructive">
                {errorCount} hata
              </span>
            ) : null}
          </CardTitle>
          <ChevronDown
            size={18}
            className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <p className="text-sm text-muted-foreground">Son işlenen banka SMS'lerinin başarı durumu.</p>
      </CardHeader>

      {open ? (
        <CardContent className="space-y-2">
          {error ? <Alert variant="destructive">{error}</Alert> : null}

          {!error && logs === null ? <p className="text-xs text-muted-foreground">Yükleniyor...</p> : null}

          {!error && logs?.length === 0 ? (
            <p className="text-xs text-muted-foreground">Henüz işlenmiş bir SMS yok.</p>
          ) : null}

          {logs?.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2.5 rounded-xl border border-border/50 bg-muted/30 p-2.5"
            >
              {log.status === 'success' ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <XCircle size={16} className="mt-0.5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">{TYPE_LABEL[log.sms_type]}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatLogDate(log.created_at)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {log.summary ?? (log.status === 'error' ? log.error_message : '—')}
                </p>
                {log.status === 'error' && log.summary && log.error_message ? (
                  <p className="text-xs text-destructive">{log.error_message}</p>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      ) : null}
    </SurfaceCard>
  )
}
