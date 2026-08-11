import { Gauge, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { fetchExpenseSourceRows, type ExpenseSourceRow } from '../../data/repositories/cardsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { buildAutomationCoverage } from '../../utils/automationCoverage'
import { addMonths, dateInputValue, startOfMonth } from '../../utils/date'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'

/**
 * Otomasyon kapsamı: harcamaların ne kadarı kendiliğinden geldi?
 * "Manuel yükü azaltalım" kararını tahminle değil bu oranla veriyoruz.
 * Kaynak alanı 2026-07-27'de eklendi; öncesindeki kayıtlar "bilinmiyor"dur ve
 * orana katılmaz, bu yüzden ilk haftalarda payda küçük olur.
 */

const WINDOW_MONTHS = 3

export function AutomationCoveragePanel() {
  const { formatAmount } = useBalancePrivacy()
  const [rows, setRows] = useState<ExpenseSourceRow[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const since = dateInputValue(addMonths(startOfMonth(), 1 - WINDOW_MONTHS))
    const result = await fetchExpenseSourceRows(since)
    if (!result.ok) {
      setError(
        isMissingSupabaseCapabilityError(result.error)
          ? missingSupabaseCapabilityMessage('Harcama kaynağı altyapısı', result.error)
          : result.error.message ?? 'Harcama kaynakları yüklenemedi.',
      )
      setRows([])
      return
    }
    setError('')
    setRows(result.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const coverage = rows ? buildAutomationCoverage(rows) : null

  return (
    <SurfaceCard className="border-info/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge size={17} />
              Otomasyon kapsamı
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Son {WINDOW_MONTHS} ayda harcamaların ne kadarı kendiliğinden kaydedildi.
            </p>
          </div>
          {coverage?.automationRate !== null && coverage !== null ? (
            <Badge variant={coverage.automationRate >= 70 ? 'success' : coverage.automationRate >= 40 ? 'secondary' : 'destructive'}>
              %{coverage.automationRate} otomatik
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {error ? <Alert variant="warning">{error}</Alert> : null}

        {rows === null ? (
          <p className="flex items-center gap-2 rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Kaynaklar okunuyor...
          </p>
        ) : null}

        {coverage && coverage.totalCount === 0 ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">
            Bu pencerede harcama kaydı yok.
          </p>
        ) : null}

        {coverage && coverage.totalCount > 0 ? (
          <>
            {coverage.classifiedCount === 0 ? (
              <p className="rounded-xl bg-muted/45 p-3 text-xs text-muted-foreground">
                Kaynak etiketi yeni eklendi; oran çıkması için birkaç yeni harcama gerekiyor.
              </p>
            ) : (
              <p className="rounded-xl bg-muted/45 p-3 text-xs text-muted-foreground">
                {coverage.manualCount} kayıt elle girildi ({coverage.classifiedCount} etiketli kayıt üzerinden).
                Elle giriş payı yüksekse otomasyonu oraya yatırmak en çok zamanı kazandırır.
              </p>
            )}

            <div className="space-y-1.5">
              {coverage.rows.map((row) => (
                <div key={row.bucket} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 whitespace-nowrap font-bold tabular-nums text-foreground">
                      {row.count} kayıt · {formatAmount(row.amount)}{' '}
                      <span className="text-xs font-normal text-muted-foreground">(%{row.countShare})</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                    <div
                      className={`h-full rounded-full ${row.bucket === 'manual' ? 'bg-warning' : row.bucket === 'unknown' ? 'bg-muted-foreground/40' : 'bg-success'}`}
                      style={{ width: `${Math.min(100, row.countShare)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </SurfaceCard>
  )
}
