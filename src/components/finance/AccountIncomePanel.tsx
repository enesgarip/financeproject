import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { useFinanceSnapshot, useInvalidateFinanceSnapshot } from '../../app/useFinanceSnapshot'
import { classifyAccountIncome, fetchAccountIncome } from '../../data/repositories/linkedWorkflowsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { AccountIncomeKind } from '../../types/database'
import { formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import { greaterThanTL, roundTL } from '../../utils/money'
import { SimpleModal } from '../SimpleModal'
import { QueryError } from '../ui/query-error'
import { Button } from '../ui/button'
import { Input, Select } from '../ui/input'

const LABELS: Record<AccountIncomeKind, string> = { salary: 'Maaş', receivable: 'Alacak tahsilatı', own_transfer: 'Kendi hesaplarımdan transfer', other: 'Diğer gelir' }

export function AccountIncomePanel({ cardId }: { cardId: string }) {
  const { user } = useAuth()
  const { formatAmount, maskText } = useBalancePrivacy()
  const snapshot = useFinanceSnapshot()
  const invalidate = useInvalidateFinanceSnapshot()
  const query = useQuery({ queryKey: ['account-income', user?.id, cardId], enabled: !!user, queryFn: async () => {
    const result = await fetchAccountIncome(cardId)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  } })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kind, setKind] = useState<AccountIncomeKind>('other')
  const [debtId, setDebtId] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const selected = query.data?.movements.find(row => row.id === selectedId)
  const debts = snapshot.data?.debts.filter(debt => debt.direction === 'borç_verdim' && debt.status === 'açık' && debt.value_type === 'TRY') ?? []

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || submitting.current) return
    const paid = roundTL(parseNumber(amount))
    if (kind === 'receivable' && (!debtId || !Number.isFinite(paid) || !greaterThanTL(paid, 0) || greaterThanTL(paid, selected.amount))) { setError('Geçerli bir alacak ve para girişini aşmayan tahsilat tutarı seç.'); return }
    submitting.current = true; setBusy(true); setError('')
    try {
      const result = await classifyAccountIncome(selected.id, kind, kind === 'receivable' ? debtId : null, kind === 'receivable' ? paid : null)
      if (!result.ok) { setError(result.error.message); return }
      setSelectedId(null)
      await Promise.all([query.refetch(), invalidate()])
    } finally { submitting.current = false; setBusy(false) }
  }

  if (query.isPending) return <p role="status" className="text-xs text-ink-muted">Para girişleri yükleniyor…</p>
  if (query.isError) return <QueryError title="Para girişleri doğrulanamadı" message={query.error.message} onRetry={() => void query.refetch()} />
  return <div className="space-y-3">
    <p className="text-xs text-ink-muted">Son 30 para girişi. Sınıflandırma bakiyeyi tekrar artırmaz. Maaş etiketi, kayıtlı maaş tutarını değiştirmez; transfer etiketi diğer hesaptan para düşmez.</p>
    {!query.data.movements.length ? <p className="text-xs text-ink-muted">Sınıflandırılabilecek para girişi yok.</p> : <ul className="divide-y divide-line">{query.data.movements.map(movement => {
      const label = query.data.labels.find(label => label.movement_id === movement.id)
      const automatic = movement.source_event_id && query.data.automaticallyMatched.includes(movement.source_event_id)
      return <li key={movement.id} className="space-y-1 py-3 text-xs">
        <p className="break-words font-semibold">{maskText(movement.title)}</p>
        <p className="text-ink-muted">{formatDate(movement.occurred_at.slice(0, 10))} · {formatAmount(movement.amount)}</p>
        {label ? <p className="font-semibold text-primary">{LABELS[label.kind]}{label.debt_amount !== null ? ` · ${formatAmount(label.debt_amount)}` : ''}</p> : automatic ? <p className="text-success">SMS ile borç/alacak kaydına zaten bağlandı.</p> : <Button size="sm" variant="outline" onClick={() => { setSelectedId(movement.id); setKind('other'); setDebtId(''); setAmount(String(movement.amount ?? '')); setError('') }}>Bu para neydi?</Button>}
      </li>
    })}</ul>}
    <SimpleModal busy={busy} title="Gelen parayı sınıflandır" open={!!selected} onClose={() => { if (!busy) setSelectedId(null) }}>
      <form onSubmit={event => void save(event)} className="space-y-4">
        <p className="text-sm">{maskText(selected?.title ?? '')} · {formatAmount(selected?.amount)}</p>
        <label className="block text-sm font-semibold">Para girişinin türü<Select className="mt-1" value={kind} onChange={event => setKind(event.target.value as AccountIncomeKind)}>{Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
        {kind === 'receivable' ? <>
          {snapshot.isError ? <QueryError title="Alacaklar yüklenemedi" onRetry={() => void snapshot.refetch()} /> : null}
          <label className="block text-sm font-semibold">Açık TL alacağı<Select className="mt-1" value={debtId} required onChange={event => setDebtId(event.target.value)}><option value="">Alacak seç</option>{debts.map(debt => <option key={debt.id} value={debt.id}>{maskText(debt.person_name)} · {formatAmount(debt.estimated_value_try)}</option>)}</Select></label>
          <label className="block text-sm font-semibold">Bu alacağa sayılacak tutar (TL)<Input inputMode="decimal" className="mt-1" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
          <p className="text-xs text-ink-muted">Yalnız seçilen alacak bu tutarda azalır. Para zaten hesabında; bakiye yeniden artmaz. Girişin kalan kısmı başka alacağa dağıtılmaz.</p>
        </> : <p className="text-xs text-ink-muted">Bu seçim mevcut harekete açıklama ekler; yeni para hareketi veya maaş kaydı oluşturmaz.</p>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="min-h-11 w-full" disabled={busy || (kind === 'receivable' && (snapshot.isPending || snapshot.isError || !debtId))}>{busy ? 'Kaydediliyor…' : 'Sınıflandırmayı kaydet'}</Button>
      </form>
    </SimpleModal>
  </div>
}
