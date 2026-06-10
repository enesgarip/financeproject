import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Card, CardLedger } from '../../types/database'
import { ledgerDrift, summarizeCardLedger } from '../../utils/cardLedger'
import { formatDate } from '../../utils/date'
import { formatCurrency } from '../../utils/formatCurrency'
import { toTL } from '../../utils/money'
import { isMissingSupabaseCapabilityError } from '../../utils/supabaseErrors'

const KIND_LABELS: Record<CardLedger['kind'], { label: string; className: string }> = {
  opening: { label: 'Başlangıç', className: 'text-muted-foreground' },
  debit: { label: 'Borç arttı', className: 'text-destructive' },
  credit: { label: 'Ödeme/azalış', className: 'text-success' },
}

const VISIBLE_EVENTS = 8

/**
 * "Bu borç neyden oluşuyor?" (roadmap D9) — the user-facing read side of the
 * card debt ledger (A2). Mounted inside the card's details section, so it only
 * fetches when opened. Hides itself while the ledger table isn't deployed.
 */
export function CardLedgerPanel({ card }: { card: Card }) {
  const [events, setEvents] = useState<CardLedger[] | null>(null)
  const [supported, setSupported] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('card_ledger')
      .select('*')
      .eq('card_id', card.id)
      .order('occurred_at', { ascending: false })
      .limit(200)

    if (error) {
      if (isMissingSupabaseCapabilityError(error)) setSupported(false)
      return
    }
    setEvents((data ?? []) as CardLedger[])
  }, [card.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (!supported || events === null) return null

  const summary = summarizeCardLedger(events)
  // Events arrive newest-first; order doesn't matter for the sums.
  const drift = ledgerDrift(events, card.debt_amount)

  return (
    <div className="mt-3 rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase text-muted-foreground">Borç hareketleri</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {summary.count} hareket · Borçlanma {formatCurrency(summary.totalDebit)} − Ödeme {formatCurrency(summary.totalCredit)} ={' '}
          <span className="font-black text-foreground">{formatCurrency(summary.net)}</span>
        </p>
      </div>

      {drift !== 0 ? (
        <p className="mt-2 rounded-lg bg-warning/8 px-3 py-2 text-xs font-semibold text-warning ring-1 ring-warning/20">
          {formatCurrency(Math.abs(drift))} hareketlerle açıklanamıyor — kayıt dışı bir {drift > 0 ? 'artış' : 'azalış'} olabilir.
        </p>
      ) : null}

      {events.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {events.slice(0, VISIBLE_EVENTS).map((event) => {
            const meta = KIND_LABELS[event.kind]
            const amount = toTL(event.amount_kurus)
            return (
              <div key={event.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 text-xs">
                <span className="min-w-0 truncate">
                  <span className={`font-black ${meta.className}`}>{meta.label}</span>
                  <span className="ml-2 text-muted-foreground">{formatDate(event.occurred_at.slice(0, 10))}</span>
                </span>
                <span className={`shrink-0 font-black tabular-nums ${meta.className}`}>
                  {amount > 0 ? '+' : ''}
                  {formatCurrency(amount)}
                </span>
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
    </div>
  )
}
