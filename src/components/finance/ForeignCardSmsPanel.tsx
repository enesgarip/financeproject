import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { completeForeignCardSms } from '../../data/repositories/foreignCardSmsRepo'
import { useForeignCardSms } from '../../app/useForeignCardSms'
import type { Card, ForeignCardSms } from '../../types/database'
import { roundTL } from '../../utils/money'
import { FeatureSection } from '../FeatureSection'
import { SimpleModal } from '../SimpleModal'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { QueryError } from '../ui/query-error'

const currencyFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ForeignCardSmsPanel({ cards, onCompleted }: { cards: Card[]; onCompleted: () => Promise<void> }) {
  const { user } = useAuth()
  const { hidden } = useBalancePrivacy()
  const { hash } = useLocation()
  const queryClient = useQueryClient()
  const queryKey = ['foreign-card-sms', user?.id]
  const query = useForeignCardSms()
  const [editing, setEditing] = useState<ForeignCardSms | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const rows = query.data?.rows ?? []
  function native(row: ForeignCardSms) { return `${hidden ? '••••' : currencyFormat.format(row.native_amount)} ${row.currency}` }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!editing || busy) return
    if (!/^\d+(?:[,.]\d{1,2})?$/.test(amount.trim())) { setError('Geçerli bir TL tutarı gir.'); return }
    const parsed = roundTL(Number(amount.trim().replace(',', '.')))
    if (parsed <= 0 || parsed >= 1e12) { setError('Sıfırdan büyük geçerli bir TL tutarı gir.'); return }
    setBusy(true); setError('')
    try {
      const result = await completeForeignCardSms(editing.id, parsed)
      if (!result.ok) { setError(result.error.message); return }
      setEditing(null); setMessage('Harcama kaydedildi.')
      try { await Promise.all([queryClient.invalidateQueries({ queryKey }), onCompleted()]) }
      catch { setMessage('Harcama kaydedildi. Güncel bakiyeleri görmek için sayfayı yenile.') }
    } catch { setError('Kayıt sonucu doğrulanamadı. Aynı TL tutarıyla tekrar deneyebilirsin.') }
    finally { setBusy(false) }
  }
  if (query.isPending) return hash === '#doviz-sms' ? <p role="status">Dövizli SMS kayıtları yükleniyor…</p> : null
  if (query.isError) return <QueryError title="Dövizli SMS kayıtları yüklenemedi" message={query.error.message} onRetry={() => void query.refetch()} />
  if (!rows.length && !query.data?.recoveryWarning && !message && hash !== '#doviz-sms') return null
  return <FeatureSection id="doviz-sms" className="border-b border-line-strong pb-4">
    <h2 className="text-base font-semibold">TL karşılığı bekleyen işlemler{rows.length ? ` · ${rows.length}` : ''}</h2>
    <p className="mt-1 text-sm text-ink-muted">Dövizli SMS’ler burada bekler. Kesin TL tutarını tamamladığında kart harcaması olarak kaydedilir. Bekleyen tutarlar borç ve harcama toplamlarına dahil değildir.</p>
    {query.data?.recoveryWarning ? <p role="alert" className="mt-2 text-sm text-warning">{query.data.recoveryWarning} <button type="button" className="min-h-11 font-semibold text-primary" onClick={() => void query.refetch()}>Yenile</button></p> : null}
    {message ? <p role="status" className="mt-2 text-sm text-success">{message}</p> : null}
    {!rows.length ? <p className="mt-2 text-sm text-ink-muted">TL karşılığı bekleyen dövizli SMS yok.</p> : <ul className="mt-3 divide-y divide-line-strong">{rows.map(row => <li key={row.id} className="space-y-2 py-3">
      <p className="break-words text-sm font-semibold">{row.description}</p>
      <p className="text-sm font-semibold tabular-nums">{native(row)}</p>
      <p className="text-xs text-ink-muted">{cards.find(card => card.id === row.card_id)?.card_name ?? 'Kredi kartı'} · {new Date(row.spent_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</p>
      <Button variant="outline" className="min-h-11 whitespace-normal" onClick={() => { setEditing(row); setAmount(''); setError('') }}>Kesin TL tutarını gir</Button>
    </li>)}</ul>}
    <SimpleModal busy={busy} title="Dövizli işlemi tamamla" open={editing !== null} onClose={() => { if (!busy) setEditing(null) }}>
      <form onSubmit={event => void submit(event)} className="space-y-4">
        <p className="break-words text-sm">{editing?.description} · {editing ? native(editing) : ''}</p>
        <label className="block text-sm font-semibold">Kesin TL tutarı<Input className="mt-1 min-h-11" inputMode="decimal" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} required /></label>
        <p className="text-sm text-ink-muted">Bankanın gösterdiği toplam TL tutarını gir. Harcama kartında provizyon olarak görünecek.</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="min-h-11 w-full">{busy ? 'Kaydediliyor…' : 'Harcamayı kaydet'}</Button>
      </form>
    </SimpleModal>
  </FeatureSection>
}
