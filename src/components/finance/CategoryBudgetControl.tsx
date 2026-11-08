import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useInvalidateFinanceSnapshot } from '../../app/useFinanceSnapshot'
import { saveCrudRow } from '../../data/repositories/crudRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Budget } from '../../types/database'
import type { BudgetUsage } from '../../utils/budgetAlerts'
import { parseNumber } from '../../utils/formatCurrency'
import { greaterThanTL, roundTL } from '../../utils/money'
import { SimpleModal } from '../SimpleModal'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/** Bütçenin kanonik kullanımı, kategori hareketlerinin yanında düzenlenir. */
export function CategoryBudgetControl({ category, month, budget, usage }: { category: string; month: string; budget?: Budget; usage?: BudgetUsage }) {
  const { user } = useAuth()
  const { formatAmount } = useBalancePrivacy()
  const invalidate = useInvalidateFinanceSnapshot()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    const limit = parseNumber(amount)
    if (!user || busy) return
    if (!Number.isFinite(limit) || !greaterThanTL(limit, 0)) { setError('Sıfırdan büyük bir limit gir.'); return }
    setBusy(true); setError('')
    try {
      const result = await saveCrudRow('budgets', {
        user_id: user.id, category, month, limit_amount: roundTL(limit), limit_anchor: 'manual', limit_anchor_value: null,
      }, budget?.id ?? null)
      if (!result.ok) throw new Error(result.error.message)
      await invalidate()
      setOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Bütçe kaydedilemedi.') }
    finally { setBusy(false) }
  }

  return <div className="space-y-1 rounded-lg bg-page p-3 text-xs text-ink-muted">
    {usage ? <><p>Bütçe kullanımı: {formatAmount(usage.spent)} / {formatAmount(usage.limit)}</p><p>Kalan: {formatAmount(usage.remaining)}</p></> : <p>Bu kategori için bu ay bütçe yok.</p>}
    <p>Bütçe kullanımı tüm kartları ve provizyonları da kapsar.</p>
    <button type="button" className="min-h-11 font-semibold text-primary" onClick={() => { setAmount(usage ? String(usage.limit).replace('.', ',') : ''); setError(''); setOpen(true) }}>{budget ? 'Limiti düzenle' : 'Bütçe belirle'}</button>
    <SimpleModal busy={busy} open={open} title={`${category} bütçesi`} onClose={() => { if (!busy) setOpen(false) }}>
      <form onSubmit={event => void save(event)} className="space-y-4">
        <label className="block text-sm font-semibold">Aylık sabit limit (TL)<Input inputMode="decimal" className="mt-1" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
        {budget?.limit_anchor && budget.limit_anchor !== 'manual' ? <p className="text-sm text-ink-muted">Kaydedince mevcut yüzde veya ortalama kuralı yerine bu sabit limit kullanılır.</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="min-h-11 w-full">{busy ? 'Kaydediliyor…' : 'Limiti kaydet'}</Button>
      </form>
    </SimpleModal>
  </div>
}
