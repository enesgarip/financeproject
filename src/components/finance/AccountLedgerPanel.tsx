import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAccountLedgerEvents } from '../../data/repositories/financePanelsRepo'
import { postAccountBalanceCorrection, recomputeAccountBalance } from '../../services/accountLedgerActions'
import type { AccountLedger, Card } from '../../types/database'
import { balanceDrift, buildAccountLedgerBalanceRows, summarizeAccountLedger } from '../../utils/accountLedger'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import { toTL } from '../../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../../utils/supabaseErrors'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const KIND_LABELS: Record<AccountLedger['kind'], { label: string; className: string }> = {
  opening: { label: 'Başlangıç', className: 'text-ink-muted' },
  deposit: { label: 'Para girişi', className: 'text-success' },
  withdrawal: { label: 'Para çıkışı', className: 'text-destructive' },
  adjustment: { label: 'Düzeltme', className: 'text-info' },
}

const VISIBLE_EVENTS = 8

/**
 * "Bu bakiye neyden oluşuyor?" — the user-facing side of the bank account
 * balance ledger (roadmap Faz 3). Mounted inside the account's details, so it
 * only fetches when opened and surfaces migration drift if the ledger table is missing.
 *
 * Faz 3.1 adds the write side (mirror of CardLedgerPanel): pull a drifted
 * balance back to the projection ("Ledger'a göre düzelt"), and post a manual fix
 * as an auditable 'adjustment' event with a reason ("Düzelt (ters kayıt)").
 */
export function AccountLedgerPanel({
  card,
  onChanged,
  formatAmount = formatCurrency,
}: {
  card: Card
  onChanged?: () => void | Promise<void>
  formatAmount?: (value: number | null | undefined) => string
}) {
  const [events, setEvents] = useState<AccountLedger[] | null>(null)
  // Compare only events loaded for this exact balance/debt revision.
  const revision = JSON.stringify([card.id, card.updated_at, card.current_balance])
  const [loadedRevision, setLoadedRevision] = useState('')
  const loadSequence = useRef(0)
  const activeRevision = useRef<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [direction, setDirection] = useState<'deposit' | 'withdrawal'>('deposit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    // A mutation may finish after its originating row revision was replaced.
    if (activeRevision.current !== revision) return
    const sequence = ++loadSequence.current
    const loadResult = await fetchAccountLedgerEvents(card.id)
    if (sequence !== loadSequence.current) return
    setLoadedRevision(revision)

    if (!loadResult.ok) {
      setLoadError(
        isMissingSupabaseCapabilityError(loadResult.error)
          ? missingSupabaseCapabilityMessage('Hesap hareketleri altyapısı', loadResult.error)
          : loadResult.error.message ?? 'Hesap hareketleri yüklenemedi.',
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
    const { error: rpcError } = await recomputeAccountBalance(card.id)
    if (rpcError) {
      setError(rpcError.message ?? 'Bakiye yeniden hesaplanamadı.')
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
    const signed = direction === 'withdrawal' ? -magnitude : magnitude
    setBusy(true)
    setError('')
    const { error: rpcError } = await postAccountBalanceCorrection(card.id, signed, note)
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

  const summary = summarizeAccountLedger(events)
  // Events arrive newest-first; order doesn't matter for the sums.
  const drift = balanceDrift(events, card.current_balance)
  const balanceRows = buildAccountLedgerBalanceRows(events, card.current_balance)

  return (
    <div className="mt-3 border-t border-line pt-4">
      <div className="space-y-2">
        <p className="serit-eyebrow">Hesap hareketleri</p>
        <p className="text-xs text-ink-muted">{summary.count} kayıt</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line pb-3 text-xs">
          <div className="min-w-0"><dt className="text-ink-muted">Toplam giriş</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(summary.totalIn)}</dd></div>
          <div className="min-w-0"><dt className="text-ink-muted">Toplam çıkış</dt><dd className="serit-num mt-1 break-words font-semibold">{formatAmount(summary.totalOut)}</dd></div>
          <div className="col-span-2 flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-line pt-2"><dt className="text-ink-muted">Hareketlerin neti</dt><dd className="serit-num font-semibold">{formatAmount(summary.net)}</dd></div>
        </dl>
      </div>

      {!busy && drift !== 0 ? (
        <div className="mt-2 rounded-lg bg-warning/8 px-3 py-2 ring-1 ring-warning/20">
          <p className="text-xs font-semibold text-warning" aria-live="polite">
            {formatAmount(Math.abs(drift))} hareketlerle açıklanamıyor — kayıt dışı bir {drift > 0 ? 'giriş' : 'çıkış'} olabilir.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={handleRecompute}
            aria-label={`${card.bank_name} ${card.card_name} bakiyesini ledger'a göre düzelt`}
          >
            {busy ? 'Düzeltiliyor…' : 'Ledger’a göre düzelt'}
          </Button>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="mt-3 divide-y divide-line">
          {balanceRows.slice(0, VISIBLE_EVENTS).map(({ event, balanceAfter }) => {
            const meta = KIND_LABELS[event.kind]
            const amountTL = toTL(event.amount_kurus)
            return (
              <div key={event.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 text-xs">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`font-semibold ${meta.className}`}>{meta.label}</span>
                  <span className="text-ink-muted">{formatDate(event.occurred_at.slice(0, 10))}</span>
                  {event.kind === 'adjustment' && event.note ? (
                    <span className="w-full break-words italic text-ink-muted">{event.note}</span>
                  ) : null}
                </span>
                <span className={`serit-num text-right font-semibold ${meta.className}`}>
                  {amountTL > 0 ? '+' : ''}
                  {formatAmount(amountTL)}
                </span>
                <span className="col-span-2 text-ink-muted">Sonrası <span className="serit-num">{formatAmount(balanceAfter)}</span></span>
              </div>
            )
          })}
          {events.length > VISIBLE_EVENTS ? (
            <p className="text-xs font-semibold text-ink-muted">+{events.length - VISIBLE_EVENTS} hareket daha</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">Henüz hareket kaydı yok; bakiye değiştikçe burada listelenecek.</p>
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
                variant={direction === 'deposit' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDirection('deposit')}
                aria-pressed={direction === 'deposit'}
              >
                Bakiye ekle (+)
              </Button>
              <Button
                type="button"
                variant={direction === 'withdrawal' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDirection('withdrawal')}
                aria-pressed={direction === 'withdrawal'}
              >
                Bakiye düş (−)
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
                placeholder="örn. bankada 50 TL fazla görünüyor"
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
