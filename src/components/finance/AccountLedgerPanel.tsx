import { useCallback, useEffect, useState } from 'react'
import { fetchAccountLedgerEvents } from '../../data/repositories/financePanelsRepo'
import { postAccountBalanceCorrection, recomputeAccountBalance } from '../../services/accountLedgerActions'
import type { AccountLedger, Card } from '../../types/database'
import { balanceDrift, summarizeAccountLedger } from '../../utils/accountLedger'
import { formatDate } from '../../utils/date'
import { formatCurrency, parseNumber } from '../../utils/formatCurrency'
import { toTL } from '../../utils/money'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const KIND_LABELS: Record<AccountLedger['kind'], { label: string; className: string }> = {
  opening: { label: 'Başlangıç', className: 'text-muted-foreground' },
  deposit: { label: 'Para girişi', className: 'text-success' },
  withdrawal: { label: 'Para çıkışı', className: 'text-destructive' },
  adjustment: { label: 'Düzeltme', className: 'text-info' },
}

const VISIBLE_EVENTS = 8

/**
 * "Bu bakiye neyden oluşuyor?" — the user-facing side of the bank account
 * balance ledger (roadmap Faz 3). Mounted inside the account's details, so it
 * only fetches when opened. Hides itself while the ledger table isn't deployed.
 *
 * Faz 3.1 adds the write side (mirror of CardLedgerPanel): pull a drifted
 * balance back to the projection ("Ledger'a göre düzelt"), and post a manual fix
 * as an auditable 'adjustment' event with a reason ("Düzelt (ters kayıt)").
 */
export function AccountLedgerPanel({ card, onChanged }: { card: Card; onChanged?: () => void | Promise<void> }) {
  const [events, setEvents] = useState<AccountLedger[] | null>(null)
  const [supported, setSupported] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [direction, setDirection] = useState<'deposit' | 'withdrawal'>('deposit')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const loadResult = await fetchAccountLedgerEvents(card.id)

    if (!loadResult.ok) {
      if (isMissingSupabaseCapabilityError(loadResult.error)) setSupported(false)
      return
    }
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
    const { error: rpcError } = await recomputeAccountBalance(card.id)
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message ?? 'Bakiye yeniden hesaplanamadı.')
      return
    }
    await afterMutation()
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
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message ?? 'Düzeltme kaydedilemedi.')
      return
    }
    setAmount('')
    setNote('')
    setFormOpen(false)
    await afterMutation()
  }

  if (!supported || events === null) return null

  const summary = summarizeAccountLedger(events)
  // Events arrive newest-first; order doesn't matter for the sums.
  const drift = balanceDrift(events, card.current_balance)

  return (
    <div className="mt-3 rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase text-muted-foreground">Hesap hareketleri</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {summary.count} hareket · Giriş {formatCurrency(summary.totalIn)} − Çıkış {formatCurrency(summary.totalOut)} ={' '}
          <span className="font-black text-foreground">{formatCurrency(summary.net)}</span>
        </p>
      </div>

      {drift !== 0 ? (
        <div className="mt-2 rounded-lg bg-warning/8 px-3 py-2 ring-1 ring-warning/20">
          <p className="text-xs font-semibold text-warning" aria-live="polite">
            {formatCurrency(Math.abs(drift))} hareketlerle açıklanamıyor — kayıt dışı bir {drift > 0 ? 'giriş' : 'çıkış'} olabilir.
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
        <div className="mt-3 flex flex-col gap-2">
          {events.slice(0, VISIBLE_EVENTS).map((event) => {
            const meta = KIND_LABELS[event.kind]
            const amountTL = toTL(event.amount_kurus)
            return (
              <div key={event.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 text-xs">
                <span className="min-w-0 truncate">
                  <span className={`font-black ${meta.className}`}>{meta.label}</span>
                  <span className="ml-2 text-muted-foreground">{formatDate(event.occurred_at.slice(0, 10))}</span>
                  {event.kind === 'adjustment' && event.note ? (
                    <span className="ml-2 italic text-muted-foreground">· {event.note}</span>
                  ) : null}
                </span>
                <span className={`shrink-0 font-black tabular-nums ${meta.className}`}>
                  {amountTL > 0 ? '+' : ''}
                  {formatCurrency(amountTL)}
                </span>
              </div>
            )
          })}
          {events.length > VISIBLE_EVENTS ? (
            <p className="text-xs font-semibold text-muted-foreground">+{events.length - VISIBLE_EVENTS} hareket daha</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Henüz hareket kaydı yok; bakiye değiştikçe burada listelenecek.</p>
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
