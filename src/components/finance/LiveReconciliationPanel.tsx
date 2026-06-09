import { Scale } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { supabase } from '../../lib/supabase'
import type { AccountReconciliation, Card, InsertFor } from '../../types/database'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import {
  buildReconciliationItems,
  computeDrift,
  isReconciled,
  latestReconciliationByCard,
  type ReconcileStatus,
} from '../../utils/reconciliation'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'
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
  const [supported, setSupported] = useState(true)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reconcilable = useMemo(
    () => cards.filter((card) => card.card_type === 'banka_karti' || card.card_type === 'kredi_karti'),
    [cards],
  )

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('account_reconciliations')
      .select('*')
      .order('reconciled_at', { ascending: false })

    if (loadError) {
      // Table not deployed yet → hide the panel silently (matches app convention).
      if (isMissingSupabaseCapabilityError(loadError)) setSupported(false)
      return
    }
    setRows((data ?? []) as AccountReconciliation[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const items = useMemo(
    () => buildReconciliationItems(reconcilable, latestReconciliationByCard(rows)),
    [reconcilable, rows],
  )

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
    const { error: saveError } = await supabase.from('account_reconciliations').insert(payload)
    setSavingId(null)

    if (saveError) {
      setError(saveError.message ?? 'Mutabakat kaydedilemedi.')
      return
    }
    setInputs((prev) => ({ ...prev, [cardId]: '' }))
    await load()
  }

  if (!supported || reconcilable.length === 0) return null

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
                      ? ` · Son mutabakat: ${formatDate(item.last.reconciled_at)}${
                          item.daysSince != null ? ` (${item.daysSince} gün önce)` : ''
                        }`
                      : ' · Henüz mutabakat yok'}
                    {item.status === 'drift' && item.last
                      ? ` · Kayıtlı fark ${item.last.drift >= 0 ? '+' : ''}${formatCurrency(item.last.drift)}`
                      : ''}
                  </p>
                </div>
              </div>

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
                  />
                </label>
                {liveDrift != null ? (
                  <span
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
