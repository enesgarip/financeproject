import { ChevronDown, ChevronUp, Scale } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import {
  fetchAccountLedgerEventsSince,
  fetchAccountReconciliations,
  fetchCardLedgerEventsSince,
  insertAccountReconciliation,
} from '../../data/repositories/financePanelsRepo'
import type { AccountReconciliation, Card, InsertFor, ReconciliationTarget } from '../../types/database'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import {
  buildDriftCauseSummary,
  buildReconciliationItems,
  computeDrift,
  isReconciled,
  latestReconciliationByCard,
  type DriftCauseSummary,
  type ReconcileStatus,
} from '../../utils/reconciliation'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { Input } from '../ui/input'

type LiveReconciliationPanelProps = {
  cards: Card[]
}

const help = {
  calculation:
    'Her banka hesabı / kredi kartı için app\'in güncel rakamı (bakiye veya borç) ile bankada gördüğün gerçek rakamı karşılaştırır. Fark = app − gerçek.',
  importance:
    'Rakamların sessizce kayması manuel finans takibini bırakmanın 1 numaralı sebebidir. Düzenli mutabakat, kaçak veya eksik girilmiş bir işlemi erken yakalar.',
  source: 'Senin girdiğin gerçek bakiye + app\'in o anki rakamı; her mutabakat kaydedilir.',
} satisfies HelpTooltipContent

const STATUS_META: Record<ReconcileStatus, { variant: 'destructive' | 'secondary' | 'warning' | 'success'; label: string }> = {
  drift: { variant: 'destructive', label: 'Fark var' },
  never: { variant: 'secondary', label: 'Hiç mutabık olunmadı' },
  stale: { variant: 'warning', label: 'Tazele' },
  ok: { variant: 'success', label: 'Mutabık' },
}

export function LiveReconciliationPanel({ cards }: LiveReconciliationPanelProps) {
  const { user } = useAuth()
  const [rows, setRows] = useState<AccountReconciliation[]>([])
  const [loadError, setLoadError] = useState('')
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [driftDetails, setDriftDetails] = useState<Record<string, DriftCauseSummary | null>>({})
  const [loadingDrift, setLoadingDrift] = useState<Record<string, boolean>>({})
  const [expandedDrift, setExpandedDrift] = useState<Record<string, boolean>>({})

  const reconcilable = useMemo(
    () => cards.filter((card) => card.card_type === 'banka_karti' || card.card_type === 'kredi_karti'),
    [cards],
  )

  const load = useCallback(async () => {
    const loadResult = await fetchAccountReconciliations()

    if (!loadResult.ok) {
      // Missing table/RPC drift stays visible; this panel should not disappear silently.
      setLoadError(
        isMissingSupabaseCapabilityError(loadResult.error)
          ? missingSupabaseCapabilityMessage('Canlı mutabakat altyapısı', loadResult.error)
          : loadResult.error.message ?? 'Mutabakat kayıtları yüklenemedi.',
      )
      return
    }
    setLoadError('')
    setRows(loadResult.data)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const items = useMemo(
    () => buildReconciliationItems(reconcilable, latestReconciliationByCard(rows)),
    [reconcilable, rows],
  )

  async function loadDriftCause(cardId: string, target: ReconciliationTarget, since: string) {
    if (driftDetails[cardId] !== undefined) {
      setExpandedDrift((prev) => ({ ...prev, [cardId]: !prev[cardId] }))
      return
    }
    setExpandedDrift((prev) => ({ ...prev, [cardId]: true }))
    setLoadingDrift((prev) => ({ ...prev, [cardId]: true }))
    const result = target === 'debt'
      ? await fetchCardLedgerEventsSince(cardId, since)
      : await fetchAccountLedgerEventsSince(cardId, since)
    if (result.ok) {
      setDriftDetails((prev) => ({ ...prev, [cardId]: buildDriftCauseSummary(result.data) }))
    }
    setLoadingDrift((prev) => ({ ...prev, [cardId]: false }))
  }

  async function handleSave(cardId: string, app: number, target: 'balance' | 'debt') {
    const raw = inputs[cardId]
    if (!user || raw == null || raw.trim() === '') return
    const real = parseNumber(raw)
    setSavingId(cardId)
    setError('')

    const payload: InsertFor<'account_reconciliations'> = {
      user_id: user.id,
      card_id: cardId,
      target,
      app_amount: app,
      real_amount: real,
      drift: computeDrift(app, real),
      reconciled_at: new Date().toISOString(),
    }
    const saveResult = await insertAccountReconciliation(payload)
    setSavingId(null)

    if (!saveResult.ok) {
      setError(saveResult.error.message ?? 'Mutabakat kaydedilemedi.')
      return
    }
    setInputs((prev) => ({ ...prev, [cardId]: '' }))
    await load()
  }

  if (reconcilable.length === 0) return null

  if (loadError) {
    return (
      <SurfaceCard className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/40">
        <CardContent className="p-4">
          <Alert variant="warning">{loadError}</Alert>
        </CardContent>
      </SurfaceCard>
    )
  }

  const actionableCount = items.filter((item) => item.status === 'drift' || item.status === 'never').length

  return (
    <SurfaceCard className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/40">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale size={17} />
              Canlı bakiye mutabakatı
              <HelpTooltip title="Canlı bakiye mutabakatı" content={help} />
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Bankadaki gerçek rakamı gir; app ile farkı anında gör ve mutabık olarak kaydet.
            </p>
          </div>
          {actionableCount > 0 ? <Badge variant="warning">{actionableCount}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-3">
        {error ? <p className="text-sm font-semibold text-destructive">{error}</p> : null}
        {items.map((item) => {
          const meta = STATUS_META[item.status]
          const raw = inputs[item.card.id] ?? ''
          const hasInput = raw.trim() !== ''
          const liveDrift = hasInput ? computeDrift(item.app, parseNumber(raw)) : null
          const reconciledNow = hasInput && isReconciled(item.app, parseNumber(raw))

          return (
            <div key={item.card.id} className="rounded-lg bg-muted/40 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">
                      {item.card.bank_name} · {item.card.card_name}
                    </p>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    <Badge variant="outline">{item.target === 'debt' ? 'Borç' : 'Bakiye'}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    App: <span className="font-semibold text-foreground">{formatCurrency(item.app)}</span>
                    {item.last
                      ? ` · Son mutabakat: ${formatDate(item.last.reconciled_at.slice(0, 10))}${
                          item.daysSince != null ? ` (${item.daysSince} gün önce)` : ''
                        }`
                      : ' · Henüz mutabakat yok'}
                    {item.status === 'drift' && item.last
                      ? ` · Kayıtlı fark ${item.last.drift >= 0 ? '+' : ''}${formatCurrency(item.last.drift)}`
                      : ''}
                  </p>
                </div>
              </div>

              {item.status === 'drift' && item.last ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => loadDriftCause(item.card.id, item.target, item.last!.reconciled_at)}
                  >
                    {expandedDrift[item.card.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Son mutabakatten bu yana hareketler
                  </button>
                  {expandedDrift[item.card.id] ? (
                    <div className="mt-1.5 rounded-md bg-background/60 px-2.5 py-2 text-xs">
                      {(() => {
                        if (loadingDrift[item.card.id]) return <p className="text-muted-foreground">Yükleniyor…</p>
                        const summary = driftDetails[item.card.id]
                        if (!summary) return null
                        if (summary.eventCount === 0) {
                          return (
                            <p className="text-muted-foreground">
                              Bu tarihten bu yana kayıtlı hareket bulunamadı — fark uygulama dışı bir işlemden kaynaklanıyor olabilir.
                            </p>
                          )
                        }
                        return (
                          <>
                            <div className="max-h-40 space-y-1 overflow-y-auto">
                              {summary.events.map((event, index) => (
                                <div key={index} className="flex items-center justify-between gap-2 text-muted-foreground">
                                  <span className="truncate">
                                    {formatDate(event.occurred_at.slice(0, 10))} · {event.kind}
                                    {event.note ? ` · ${event.note}` : ''}
                                  </span>
                                  <span className={`shrink-0 tabular-nums font-semibold ${event.amountTL >= 0 ? 'text-foreground' : 'text-success'}`}>
                                    {event.amountTL >= 0 ? '+' : ''}{formatCurrency(event.amountTL)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-1.5 border-t pt-1.5 font-semibold text-foreground">
                              {summary.eventCount} hareket, toplam{' '}
                              {summary.totalChangeTL >= 0 ? '+' : ''}
                              {formatCurrency(summary.totalChangeTL)} değişim
                            </p>
                          </>
                        )
                      })()}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-[140px] text-xs font-semibold text-muted-foreground">
                  Bankadaki gerçek {item.target === 'debt' ? 'borç' : 'bakiye'}
                  <Input
                    value={raw}
                    onChange={(event) => setInputs((prev) => ({ ...prev, [item.card.id]: event.target.value }))}
                    type="text"
                    inputMode="decimal"
                    placeholder="0,00"
                    className="mt-1 tabular-nums"
                    aria-label={`${item.card.bank_name} ${item.card.card_name} bankadaki gerçek ${item.target === 'debt' ? 'borç' : 'bakiye'}`}
                  />
                </label>
                {liveDrift != null ? (
                  <span
                    aria-live="polite"
                    className={`pb-2 text-sm font-semibold ${
                      reconciledNow ? 'text-success' : 'text-destructive'
                    }`}
                  >
                    {reconciledNow ? 'Mutabık ✓' : `Fark ${liveDrift >= 0 ? '+' : ''}${formatCurrency(liveDrift)}`}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!hasInput || savingId === item.card.id}
                  onClick={() => handleSave(item.card.id, item.app, item.target)}
                  aria-label={`${item.card.bank_name} ${item.card.card_name} mutabakatını kaydet`}
                >
                  {savingId === item.card.id ? 'Kaydediliyor…' : 'Mutabık kaydet'}
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </SurfaceCard>
  )
}
