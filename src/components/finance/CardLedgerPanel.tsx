import { useCallback, useEffect, useRef, useState } from 'react'
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
  opening: { label: 'Başlangıç', className: 'text-ink-muted' },
  debit: { label: 'Borç arttı', className: 'text-destructive' },
  credit: { label: 'Ödeme/azalış', className: 'text-success' },
  adjustment: { label: 'Düzeltme', className: 'text-info' },
  reclass: { label: 'Kırılım değişikliği', className: 'text-ink-muted' },
}

const VISIBLE_EVENTS = 10

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
  const historyRef = useRef<HTMLOListElement>(null)
  const [pagination, setPagination] = useState({ cardId: card.id, page: 0 })
  const [events, setEvents] = useState<CardLedger[] | null>(null)
  // Compare only events loaded for this exact balance/debt revision.
  const revision = JSON.stringify([card.id, card.updated_at, card.debt_amount])
  const [loadedRevision, setLoadedRevision] = useState('')
  const loadSequence = useRef(0)
  const activeRevision = useRef<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    // A mutation may finish after its originating row revision was replaced.
    if (activeRevision.current !== revision) return
    const sequence = ++loadSequence.current
    const loadResult = await fetchCardLedgerEvents(card.id)
    if (sequence !== loadSequence.current) return
    setLoadedRevision(revision)

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
  }, [card.id, revision])

  useEffect(() => {
    activeRevision.current = revision
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => {
      activeRevision.current = null
      loadSequence.current += 1
    }
  }, [load, revision])

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

  if (loadedRevision !== revision) return <p role="status" className="mt-3 text-xs text-ink-muted">Hareketler yükleniyor…</p>
  if (loadError) return <Alert variant="warning" className="mt-3">{loadError}</Alert>
  if (events === null) return null

  const summary = summarizeCardLedger(events)
  // Events arrive newest-first; order doesn't matter for the sums.
  const drift = ledgerDrift(events, card.debt_amount)
  const splitProjection = projectCardSplit(events)
  const pageCount = Math.max(1, Math.ceil(events.length / VISIBLE_EVENTS))
  const page = pagination.cardId === card.id ? Math.min(pagination.page, pageCount - 1) : 0
  const start = page * VISIBLE_EVENTS
  const visibleEvents = events.slice(start, start + VISIBLE_EVENTS)
  function showPage(nextPage: number) {
    setPagination({ cardId: card.id, page: nextPage })
    historyRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    historyRef.current?.focus({ preventScroll: true })
  }

  return (
    <section className="mt-4 min-w-0 border-t border-line pt-4" aria-label="Kart borç hareketleri">
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-ink">Borç hareketleri</h3><p className="text-xs text-ink-muted">{summary.count} hareket</p></div>
        <dl className="grid gap-3 border-b border-line pb-4 min-[460px]:grid-cols-3">
          <div className="min-w-0"><dt className="text-xs text-ink-muted">Borçlanma</dt><dd className="serit-num mt-1 break-words text-base font-semibold">{formatAmount(summary.totalDebit)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-ink-muted">Ödeme/azalış</dt><dd className="serit-num mt-1 break-words text-base font-semibold">{formatAmount(summary.totalCredit)}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-ink-muted">Hareketlerin neti</dt><dd className="serit-num mt-1 break-words text-base font-semibold">{formatAmount(summary.net)}</dd></div>
        </dl>
      </div>

      {splitProjection.complete && summary.count > 0 ? (
        <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-primary">Hareketlerden hesaplanan borç dağılımı</summary>
          <dl className="grid gap-3 pb-3 text-sm min-[460px]:grid-cols-3">
            <div className="min-w-0"><dt className="text-xs text-ink-muted">Ekstre</dt><dd className="serit-num mt-1 break-words">{formatAmount(splitProjection.statement)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-ink-muted">Dönem içi</dt><dd className="serit-num mt-1 break-words">{formatAmount(splitProjection.current)}</dd></div>
            <div className="min-w-0"><dt className="text-xs text-ink-muted">Provizyon</dt><dd className="serit-num mt-1 break-words">{formatAmount(splitProjection.provision)}</dd></div>
          </dl>
        </details>
      ) : null}

      {!busy && drift !== 0 ? (
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
        <div className="mt-3">
        <ol ref={historyRef} tabIndex={-1} aria-label="Kart borç hareketi kayıtları" className="scroll-mt-[calc(env(safe-area-inset-top)+6rem)] divide-y divide-line">
          {visibleEvents.map((event) => {
            const meta = KIND_LABELS[event.kind]
            const amountTL = toTL(event.amount_kurus)
            return (
              <li key={event.id} className="min-w-0 py-4 text-[13px]">
                <div className="grid min-w-0 items-start gap-x-4 gap-y-2 min-[460px]:grid-cols-[minmax(0,1fr)_auto]">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className={`font-semibold ${meta.className}`}>{meta.label}</span>
                    <span className="text-xs text-ink-muted">{formatDate(event.occurred_at.slice(0, 10))}</span>
                    {(event.kind === 'adjustment' || event.kind === 'reclass') && event.note ? (
                      <span className="w-full whitespace-pre-wrap break-words text-xs text-ink-muted">{event.note}</span>
                    ) : null}
                  </span>
                  <span className={`serit-num break-words font-semibold min-[460px]:text-right ${meta.className}`}>
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
                  return <p className="mt-2 break-words text-xs leading-5 text-ink-muted">{parts.join(' · ')}</p>
                })() : null}
              </li>
            )
          })}
        </ol>
          {events.length > VISIBLE_EVENTS ? (
            <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3" aria-label="Kart hareketi sayfaları">
              <p className="text-xs text-ink-muted" role="status">{start + 1}–{Math.min(start + VISIBLE_EVENTS, events.length)} / {events.length} hareket · Sayfa {page + 1} / {pageCount}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={page === 0} onClick={() => showPage(0)}>En yeni</Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={page === 0} onClick={() => showPage(page - 1)}>Daha yeni</Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={page + 1 >= pageCount} onClick={() => showPage(page + 1)}>Daha eski</Button>
                <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={page + 1 >= pageCount} onClick={() => showPage(pageCount - 1)}>En eski</Button>
              </div>
            </nav>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Henüz hareket kaydı yok; borç değiştikçe burada listelenecek.</p>
      )}

      <div className="mt-3 border-t border-line-strong pt-3">
        <button
          type="button"
          onClick={() => {
            setFormOpen((open) => !open)
            setError('')
          }}
          aria-expanded={formOpen}
          className="min-h-11 text-xs font-semibold text-primary underline-offset-2 hover:underline"
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
            <label className="text-xs font-semibold text-ink-muted">
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
            <label className="text-xs font-semibold text-ink-muted">
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
    </section>
  )
}
