import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { fetchCardPaymentMatchRows, fetchSubscriptionExpenses } from '../../data/repositories/cardsRepo'
import { saveCrudRow } from '../../data/repositories/crudRepo'
import type { Card } from '../../types/database'
import { candidatePlanDraft, discoverSubscriptions, discoverySince, type DiscoveryExpense, type DiscoveryPayment, type SubscriptionCandidate } from '../../utils/subscriptionDiscovery'
import { formatDate } from '../../utils/date'

type Props = {
  expenses: DiscoveryExpense[]
  payments: DiscoveryPayment[]
  cards: Pick<Card, 'id' | 'card_name' | 'card_type'>[]
}

export function SubscriptionDiscoveryPanel({ expenses, payments, cards }: Props) {
  const candidates = useMemo(() => discoverSubscriptions(expenses, payments), [expenses, payments])
  const [includePlanned, setIncludePlanned] = useState(false)
  const visible = includePlanned ? candidates : candidates.filter((candidate) => candidate.status !== 'planned')
  const plannedCount = candidates.filter((candidate) => candidate.status === 'planned').length
  return (
    <section aria-label="Ekstrelerden abonelik adayları" className="space-y-3 text-left">
      <h3 className="font-semibold text-ink">Ekstrelerden abonelik adayları</h3>
      <p className="text-xs text-ink-muted">İki ay tekrar olası, üç ay ve üzeri güçlü adaydır. Yeni adaylar planlanana kadar aylık ödeme planına eklenmez.</p>
      {plannedCount > 0 ? <button type="button" aria-expanded={includePlanned} className="min-h-11 text-sm font-semibold text-primary" onClick={() => setIncludePlanned((value) => !value)}>{includePlanned ? 'Yalnız incelenecek adayları göster' : `${plannedCount} zaten kayıtlı adayı göster`}</button> : null}
      {visible.length === 0 ? <p className="text-sm text-ink-muted">{candidates.length === 0 ? 'Yüklü son altı ayda düzenli bir tekrar bulunamadı.' : 'İncelenecek yeni aday yok.'}</p> : visible.map((candidate) => (
        <CandidateRow key={candidate.id} candidate={candidate} expenses={expenses} payments={payments} cards={cards} />
      ))}
    </section>
  )
}

function CandidateRow({ candidate, expenses, cards }: Props & { candidate: SubscriptionCandidate }) {
  const { user } = useAuth()
  const { formatAmount } = useBalancePrivacy()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(candidate.needsServiceName ? '' : candidate.merchant)
  const [day, setDay] = useState(Number(candidate.dates.at(-1)!.slice(8, 10)))
  const [confirmed, setConfirmed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const card = cards.find((c) => c.id === candidate.cardId)
  const actionable = !saved && candidate.isActive && card?.card_type === 'kredi_karti'
    && (candidate.status === 'new' || candidate.status === 'missing_recurrence')
  const status = saved || candidate.status === 'planned' ? 'Zaten kayıtlı'
    : candidate.status === 'missing_recurrence' ? 'Tekrar tanımı eksik'
      : candidate.status === 'ambiguous' ? 'Plan eşleşmesi belirsiz' : 'Yeni aday'

  async function save() {
    if (!user || saving.current) return
    const draft = candidatePlanDraft(candidate, title, day)
    if (!draft || !confirmed) { setError('Hizmet adını, günü ve aylık tekrar onayını kontrol et.'); return }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      // Re-read before writing: another panel or a prior import may have planned it.
      const fresh = await fetchCardPaymentMatchRows(candidate.cardId)
      if (!fresh.ok) { setError(fresh.error.message); return }
      const current = discoverSubscriptions(expenses, fresh.data).find((c) => c.id === candidate.id)
      if (!current || current.status === 'ambiguous') { setError('Eşleşme değişti. Listeyi yenileyip tekrar incele.'); return }
      if (current.status === 'planned') { setSaved(true); setEditing(false); return }
      const existing = current.paymentId ? fresh.data.find((p) => p.id === current.paymentId) : null
      // Repair recurrence only; preserve the existing name, price and matching rules.
      const payload = existing ? {
        recurrence: draft.recurrence, recurrence_day: draft.recurrence_day,
        due_date: draft.due_date, recurrence_end_date: null,
      } : { user_id: user.id, ...draft }
      const result = await saveCrudRow('payments', payload, existing?.id ?? null)
      if (!result.ok) { setError(result.error.message); return }
      setSaved(true)
      setEditing(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['finance-snapshot'] }),
        queryClient.invalidateQueries({ queryKey: ['crud-rows', 'payments'] }),
        queryClient.invalidateQueries({ queryKey: ['subscription-discovery'] }),
      ])
    } catch { setError('Plan kaydedilemedi. Yeniden dene.') }
    finally { saving.current = false; setBusy(false) }
  }

  return (
    <article className="space-y-2 rounded-xl border border-line-strong p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="break-words font-semibold text-ink">{candidate.merchant}</p>
          <p className="text-xs text-ink-muted">{card?.card_name ?? 'Kart'} · {status} · {candidate.confidence === 'strong' ? 'Güçlü aday' : 'Olası abonelik'}</p></div>
        <span className="font-mono text-ink">{formatAmount(candidate.amount)}</span>
      </div>
      <p className="text-xs text-ink-muted">Son işlem: {formatDate(candidate.dates.at(-1)!)} · {new Set(candidate.dates.map((d) => d.slice(0, 7))).size} farklı ay{candidate.priceChanged ? ' · Tutar değişmiş; son tutar gösteriliyor' : ''}</p>
      <details className="text-xs text-ink-muted"><summary className="cursor-pointer">Tekrar tarihleri</summary><p className="mt-1">{candidate.dates.map(formatDate).join(' · ')}</p></details>
      {!candidate.isActive ? <p className="text-xs text-ink-muted">Son iki takvim ayında görülmedi; devam ettiğini kontrol et.</p> : null}
      {candidate.status === 'ambiguous' ? <p className="text-xs text-ink-muted">Birden fazla plan veya mevcut planın eski fiyatı olabilir. Planlı ödemelerden kontrol et.</p> : null}
      {candidate.needsServiceName ? <p className="text-xs text-ink-muted">Apple işyeri adı hizmeti belirtmiyor. Hizmet adını sen belirlemelisin.</p> : null}
      {!candidate.calendarMonthly ? <p className="text-xs text-ink-muted">Tekrar günleri değişiyor veya dönemlik alışveriş olabilir. Aylık abonelik olduğunu doğrula.</p> : null}
      {actionable && !editing ? <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-line-strong px-3 py-2 font-semibold text-ink">{candidate.status === 'missing_recurrence' ? 'Aylık tekrarı düzenle' : 'İncele ve planla'}</button> : null}
      {editing ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void save() }}>
        {candidate.status === 'new' ? <label className="block text-xs text-ink-muted">Hizmet adı<input required value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line-strong bg-page p-2 text-sm text-ink" /></label> : null}
        <label className="block text-xs text-ink-muted">Her ayın günü<input required type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} className="ml-2 w-20 rounded-lg border border-line-strong bg-page p-2 text-ink" /></label>
        <label className="flex items-start gap-2 text-xs text-ink-muted"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Bu ödeme her ay tekrarlanıyor; seçtiğim günde aylık plan oluşturulsun.</label>
        <div className="flex gap-2"><button disabled={busy || !confirmed} className="rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Kaydediliyor...' : 'Aylık planı kaydet'}</button><button type="button" disabled={busy} onClick={() => setEditing(false)} className="px-3 py-2 text-ink-muted">Vazgeç</button></div>
      </form> : null}
      {error ? <p role="alert" className="text-xs text-warning">{error}</p> : null}
      {saved ? <p role="status" className="text-xs text-success">Aylık plan kayıtlı.</p> : null}
    </article>
  )
}

/** Mounted only after successful import, so its data includes the committed rows. */
export function StatementSubscriptionDiscovery({ card }: { card: Card }) {
  const { user } = useAuth()
  const since = discoverySince()
  const query = useQuery({
    queryKey: ['subscription-discovery', user?.id, card.id, since],
    enabled: Boolean(user), staleTime: 0,
    queryFn: async () => {
      const [expenses, payments] = await Promise.all([fetchSubscriptionExpenses(card.id, since), fetchCardPaymentMatchRows(card.id)])
      if (!expenses.ok) throw new Error(expenses.error.message)
      if (!payments.ok) throw new Error(payments.error.message)
      return { expenses: expenses.data, payments: payments.data }
    },
  })
  if (query.isPending) return <p role="status" className="text-sm text-ink-muted">Abonelik tekrarları kontrol ediliyor...</p>
  if (query.isError) return <div role="alert" className="text-sm text-warning"><p>Ekstre kaydedildi; abonelik adayları yüklenemedi.</p><button type="button" onClick={() => void query.refetch()} className="p-2 underline">Tekrar dene</button></div>
  return <SubscriptionDiscoveryPanel {...query.data} cards={[card]} />
}
