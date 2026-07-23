import { useCallback, useEffect, useState } from 'react'
import { fetchCardLedgerEvents } from '../../data/repositories/financePanelsRepo'
import { postCardDebtCorrection, recomputeCardDebt } from '../../services/cardLedgerActions'
import type { Card, CardLedger } from '../../types/database'
import { ledgerDrift, projectCardSplit, summarizeCardLedger } from '../../utils/cardLedger'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import { toTL } from '../../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const KIND_LABELS: Record<CardLedger['kind'], { label: string; className: string }> = {
  opening: { label: 'Başlangıç', className: 'text-muted-foreground' },
  debit: { label: 'Borç arttı', className: 'text-destructive' },
  credit: { label: 'Ödeme/azalış', className: 'text-success' },
  adjustment: { label: 'Düzeltme', className: 'text-info' },
  reclass: { label: 'Kırılım değişikliği', className: 'text-muted-foreground' },
}

const VISIBLE_EVENTS = 8

/**
 * "Bu borç neyden oluşuyor?" (roadmap D9) — the user-facing read side of the
 * card debt ledger (A2). Mounted inside the card's details section, so it only
 * fetches when opened and surfaces migration drift if the ledger table is missing.
 *
 * A2.1 adds the write side: when the stored debt drifts from the ledger it can
 * be pulled back to the projection ("Ledger'a göre düzelt"), and a manual fix is
 * posted as an auditable 'adjustment' event with a reason instead of a silent
 * overwrite ("Düzelt (ters kayıt)").
 */
export function CardLedgerPanel({
  card,
  onChanged,
  formatAmount = formatCurrency,
}: {
  card: Card
  onChanged?: () => void | Promise<void>
  formatAmount?: (value: number | null | undefined) => string
}) {
  const [events, setEvents] = useState<CardLedger[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const loadResult = await fetchCardLedgerEvents(card.id)

    if (!loadResult.ok) {
      setLoadError(
        isMissingSupabaseCapabilityError(loadResult.error)
          ? missingSupabaseCapabilityMessage('Kart borç hareketleri altyapısı', loadResult.error)
          : loadResult.error.message ?? 'Kart borç hareketleri yüklenemedi.',
      )
      return
    }
    setLoadError('')
    setEvents(loadResult.data)
  }, [card.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function afterMutation() {
    await load()
    await onChanged?.()
  }

  async function handleRecompute() {
    setBusy(true)
    setError('')
    const { error: rpcError } = await recomputeCardDebt(card.id)
    if (rpcError) {
      setError(rpcError.message ?? 'Borç yeniden hesaplanamadı.')
      setBusy(false)
      return
    }
    await afterMutation()
    setBusy(false)
  }

  async function handleCorrection() {
    const magnitude = Math.abs(parseNumber(amount))
    if (magnitude <= 0) {
      setError('Geçerli bir tutar gir.')
      return
    }
    const signed = direction === 'credit' ? -magnitude : magnitude
    setBusy(true)
    setError('')
    const { error: rpcError } = await postCardDebtCorrection(card.id, signed, note)
    if (rpcError) {
      setError(rpcError.message ?? 'Düzeltme kaydedilemedi.')
      setBusy(false)
      return
    }
    setAmount('')
    setNote('')
    setFormOpen(false)
    await afterMutation()
    setBusy(false)
  }

  if (loadError) return <Alert variant="warning" className="mt-3">{loadError}</Alert>
  if (events === null) return null

  const summary = summarizeCardLedger(events)
  // Events arrive newest-first; order doesn't matter for the sums.
  const drift = ledgerDrift(events, card.debt_amount)
  const splitProjection = projectCardSplit(events)

  return (
    <div className="mt-3 rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase text-muted-foreground">Borç hareketleri</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {summary.count} hareket · Borçlanma {formatAmount(summary.totalDebit)} − Ödeme {formatAmount(summary.totalCredit)} ={' '}
          <span className="font-black text-foreground">{formatAmount(summary.net)}</span>
        </p>
      </div>

      {splitProjection.complete && summary.count > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Kova projeksiyonu: Ekstre {formatAmount(splitProjection.statement)} · Dönem {formatAmount(splitProjection.current)} · Provizyon {formatAmount(splitProjection.provision)}
        </p>
      ) : null}

      {drift !== 0 ? (
        <div className="mt-2 rounded-lg bg-warning/8 px-3 py-2 ring-1 ring-warning/20">
          <p className="text-xs font-semibold text-warning" aria-live="polite">
            {formatAmount(Math.abs(drift))} hareketlerle açıklanamıyor — kayıt dışı bir {drift > 0 ? 'artış' : 'azalış'} olabilir.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={handleRecompute}
            aria-label={`${card.bank_name} ${card.card_name} borcunu ledger'a göre düzelt`}
          >
            {busy ? 'Düzeltiliyor…' : 'Ledger’a göre düzelt'}
          </Button>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {events.slice(0, VISIBLE_EVENTS).map((event) => {
            const meta = KIND_LABELS[event.kind]
            const amountTL = toTL(event.amount_kurus)
            return (
              <div key={event.id} className="rounded-lg bg-muted/55 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className={`font-black ${meta.className}`}>{meta.label}</span>
                    <span className="ml-2 text-muted-foreground">{formatDate(event.occurred_at.slice(0, 10))}</span>
                    {(event.kind === 'adjustment' || event.kind === 'reclass') && event.note ? (
                      <span className="ml-2 italic text-muted-foreground">· {event.note}</span>
                    ) : null}
                  </span>
                  <span className={`shrink-0 font-black tabular-nums ${meta.className}`}>
                    {amountTL > 0 ? '+' : ''}
                    {formatAmount(amountTL)}
                  </span>
                </div>
                {event.statement_delta_kurus != null || event.current_delta_kurus != null || event.provision_delta_kurus != null ? (() => {
                  const parts: string[] = []
                  const s = toTL(event.statement_delta_kurus ?? 0)
                  const c = toTL(event.current_delta_kurus ?? 0)
                  const p = toTL(event.provision_delta_kurus ?? 0)
                  if (s !== 0) parts.push(`ekstre ${s > 0 ? '+' : ''}${formatAmount(s)}`)
                  if (c !== 0) parts.push(`dönem ${c > 0 ? '+' : ''}${formatAmount(c)}`)
                  if (p !== 0) parts.push(`provizyon ${p > 0 ? '+' : ''}${formatAmount(p)}`)
                  if (parts.length === 0) return null
                  return <p className="mt-0.5 text-[10px] text-muted-foreground">{parts.join(' · ')}</p>
                })() : null}
              </div>
            )
          })}
          {events.length > VISIBLE_EVENTS ? (
            <p className="text-xs font-semibold text-muted-foreground">+{events.length - VISIBLE_EVENTS} hareket daha</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Henüz hareket kaydı yok; borç değiştikçe burada listelenecek.</p>
      )}

      <div className="mt-3 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => {
            setFormOpen((open) => !open)
            setError('')
          }}
          aria-expanded={formOpen}
          className="text-xs font-black text-info underline-offset-2 hover:underline"
        >
          {formOpen ? 'Düzeltmeyi kapat' : 'Düzelt (ters kayıt)'}
        </button>

        {formOpen ? (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === 'debit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDirection('debit')}
                aria-pressed={direction === 'debit'}
              >
                Borcu artır (+)
              </Button>
              <Button
                type="button"
                variant={direction === 'credit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDirection('credit')}
                aria-pressed={direction === 'credit'}
              >
                Borcu azalt (−)
              </Button>
            </div>
            <label className="text-xs font-semibold text-muted-foreground">
              Tutar
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                className="mt-1 tabular-nums"
                aria-label={`${card.bank_name} ${card.card_name} düzeltme tutarı`}
              />
            </label>
            <label className="text-xs font-semibold text-muted-foreground">
              Sebep
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                type="text"
                placeholder="örn. banka ekstresinde 50 TL fazla"
                className="mt-1"
                aria-label={`${card.bank_name} ${card.card_name} düzeltme sebebi`}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={busy || !amount.trim() || !note.trim()}
              onClick={handleCorrection}
            >
              {busy ? 'Kaydediliyor…' : 'Düzeltmeyi kaydet'}
            </Button>
          </div>
        ) : null}

        {error ? <p className="mt-2 text-xs font-semibold text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
