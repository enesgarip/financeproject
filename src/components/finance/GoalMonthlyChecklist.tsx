import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { SavingsGoal } from '../../types/database'
import { deleteGoalMonthlyEntry, fetchGoalMonthlyData, saveGoalMonthlyEntry, saveGoalMonthlyPlan } from '../../data/repositories/savingsGoalsRepo'
import { buildGoalMonthlyRows, type GoalMonthlyRow } from '../../utils/goalMonthly'
import { dateInputValue, startOfMonth } from '../../utils/date'
import { formatComponentAmount } from '../../utils/savingsGoal'
import { roundTL } from '../../utils/money'
import { DeferredDetails } from '../ui/deferred-details'
import { QueryError } from '../ui/query-error'
import { Button } from '../ui/button'
import { Input, Select } from '../ui/input'
import { SimpleModal } from '../SimpleModal'

const statusLabels = { complete: '✓ Tamamlandı', missed: '✕ Eksik kaldı', pending: '◷ Bekliyor', unknown: '— Kayıt yok' }
const quantityFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 })

function formatMonthlyAmount(plan: GoalMonthlyRow['plan'], amount: number) {
  if (plan.value_type === 'TRY') return formatComponentAmount(plan, amount)
  return `${quantityFormat.format(amount)} ${plan.value_type === 'gram_altin' ? 'gram' : 'çeyrek'}`
}

function parseQuantity(text: string): number | null {
  if (!/^\d+(?:[,.]\d{1,6})?$/.test(text.trim())) return null
  const amount = Number(text.trim().replace(',', '.'))
  return Number.isFinite(amount) && amount <= 1e9 ? amount : null
}

export function GoalMonthlyChecklist({ goal }: { goal: SavingsGoal }) {
  return (
    <DeferredDetails summary="Aylık takip" className="mt-3 border-t border-line-strong pt-3" summaryClassName="cursor-pointer py-2 text-sm font-semibold text-primary">
      <MonthlyChecklistContent goal={goal} />
    </DeferredDetails>
  )
}

function MonthlyChecklistContent({ goal }: { goal: SavingsGoal }) {
  const { user } = useAuth()
  const { hidden } = useBalancePrivacy()
  const queryClient = useQueryClient()
  const queryKey = ['goal-monthly', user?.id]
  const query = useQuery({ queryKey, enabled: !!user, queryFn: async () => {
    const result = await fetchGoalMonthlyData()
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  } })
  const today = new Date()
  const currentMonth = dateInputValue(startOfMonth(today))
  const [year, setYear] = useState(today.getFullYear())
  const [planOpen, setPlanOpen] = useState(false)
  const [monthlyAmount, setMonthlyAmount] = useState('')
  const [startsOn, setStartsOn] = useState(currentMonth.slice(0, 7))
  const [source, setSource] = useState<'gold_buys' | 'manual'>(goal.value_type === 'TRY' ? 'manual' : 'gold_buys')
  const [editing, setEditing] = useState<GoalMonthlyRow | null>(null)
  const [actual, setActual] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const data = query.data
  const plans = data?.plans.filter(plan => plan.goal_id === goal.id) ?? []
  const currentPlan = plans.filter(plan => plan.effective_month <= currentMonth).toSorted((a, b) => b.effective_month.localeCompare(a.effective_month))[0]
  const rows = data ? buildGoalMonthlyRows(goal.id, data.plans, data.entries, data.lots, today, year) : []
  const firstYear = plans.length ? Math.min(...plans.map(plan => Number(plan.effective_month.slice(0, 4)))) : today.getFullYear()
  const unit = goal.value_type === 'TRY' ? 'TL' : goal.value_type === 'gram_altin' ? 'gram' : 'çeyrek'
  const format = (row: GoalMonthlyRow, amount: number) => hidden ? '••••' : formatMonthlyAmount(row.plan, amount)

  async function savePlan(event: FormEvent) {
    event.preventDefault()
    if (!user || goal.value_type === 'composite') return
    const amount = parseQuantity(monthlyAmount)
    const effectiveMonth = plans.length ? currentMonth : `${startsOn}-01`
    if (amount === null || amount <= 0 || (goal.value_type === 'TRY' && roundTL(amount) <= 0) || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(effectiveMonth) || effectiveMonth > currentMonth || effectiveMonth < '1900-01-01') {
      setError('Geçerli bir başlangıç ayı ve sıfırdan büyük aylık miktar gir.'); return
    }
    setBusy(true); setError('')
    try {
      const result = await saveGoalMonthlyPlan({
        user_id: user.id, goal_id: goal.id, effective_month: effectiveMonth,
        value_type: goal.value_type, target_amount: goal.value_type === 'TRY' ? roundTL(amount) : amount,
        source, automatic_from: source === 'gold_buys' ? currentMonth : null,
      })
      if (!result.ok) throw new Error(result.error.message)
      await queryClient.invalidateQueries({ queryKey })
      setPlanOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Aylık plan kaydedilemedi.') }
    finally { setBusy(false) }
  }

  async function saveActual(event: FormEvent) {
    event.preventDefault()
    if (!user || !editing) return
    const amount = parseQuantity(actual)
    if (amount === null || amount < 0) { setError('Sıfır veya daha büyük geçerli bir miktar gir.'); return }
    setBusy(true); setError('')
    try {
      const result = await saveGoalMonthlyEntry({ user_id: user.id, goal_id: goal.id, month: editing.month, amount: editing.plan.value_type === 'TRY' ? roundTL(amount) : amount })
      if (!result.ok) throw new Error(result.error.message)
      await queryClient.invalidateQueries({ queryKey })
      setEditing(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Miktar kaydedilemedi.') }
    finally { setBusy(false) }
  }

  async function removeActual(row: GoalMonthlyRow) {
    setBusy(true); setError('')
    try {
      const result = await deleteGoalMonthlyEntry(goal.id, row.month)
      if (!result.ok) throw new Error(result.error.message)
      await queryClient.invalidateQueries({ queryKey })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Elle girilen miktar kaldırılamadı.') }
    finally { setBusy(false) }
  }

  if (query.isPending) return <p role="status" className="text-sm text-ink-muted">Aylık takip yükleniyor…</p>
  if (query.isError) return <QueryError title="Aylık takip yüklenemedi" message={query.error.message} onRetry={() => void query.refetch()} />

  return (
    <div className="space-y-3" aria-label={`${goal.name} aylık takibi`}>
      {error && !planOpen && !editing ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {currentPlan ? <p className="text-sm text-ink">Her ay {hidden ? '••••' : formatMonthlyAmount(currentPlan, currentPlan.target_amount)}</p> : <p className="text-sm text-ink-muted">Her ay ne kadar biriktirmek istediğini belirle.</p>}
      <Button variant="outline" className="min-h-11 w-full whitespace-normal" onClick={() => {
        setMonthlyAmount(currentPlan ? String(currentPlan.target_amount).replace('.', ',') : '')
        setSource(goal.value_type === 'TRY' ? 'manual' : currentPlan?.source ?? 'gold_buys')
        setStartsOn(currentMonth.slice(0, 7)); setError(''); setPlanOpen(true)
      }}>{currentPlan ? 'Aylık planı değiştir' : 'Aylık plan oluştur'}</Button>
      {currentPlan?.source === 'gold_buys' ? <p className="text-xs text-ink-muted">Altın defterindeki tüm {currentPlan.value_type === 'gram_altin' ? 'gram' : 'çeyrek'} alımları sayılır; satışlar düşülmez. Tarihi olmayan alımlar sayılmaz.</p> : null}
      {plans.length > 0 ? <>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" disabled={year <= firstYear} aria-label="Önceki yıl" onClick={() => setYear(value => value - 1)}>‹</Button>
          <span className="font-semibold tabular-nums">{year}</span>
          <Button variant="outline" disabled={year >= today.getFullYear()} aria-label="Sonraki yıl" onClick={() => setYear(value => value + 1)}>›</Button>
        </div>
        <ul className="divide-y divide-line-strong">
          {rows.map(row => <li key={row.month} className="space-y-1 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{new Date(`${row.month}T00:00:00`).toLocaleDateString('tr-TR', { month: 'long' })}</span>
              <span className={row.status === 'complete' ? 'text-success' : row.status === 'missed' ? 'text-destructive' : 'text-ink-muted'}>{statusLabels[row.status]}</span>
            </div>
            <p className="break-words text-xs tabular-nums text-ink-muted">{row.amount === null ? '—' : format(row, row.amount)} / {format(row, row.plan.target_amount)} · {row.manual ? 'Elle girildi' : row.plan.source === 'gold_buys' ? 'Alım kayıtları' : 'Elle takip'}</p>
            <div className="flex flex-wrap gap-2">
              <button className="min-h-11 text-xs font-semibold text-primary" disabled={busy} onClick={() => { setEditing(row); setActual(row.amount === null ? '' : String(row.amount).replace('.', ',')); setError('') }}>{row.manual ? 'Miktarı düzenle' : 'Gerçekleşen miktarı gir'}</button>
              {row.manual ? <button className="min-h-11 text-xs font-semibold text-ink-muted" disabled={busy} onClick={() => void removeActual(row)}>Elle girişi kaldır</button> : null}
            </div>
          </li>)}
        </ul>
        <p className="text-xs text-ink-muted">Ay bitene kadar eksik miktar beklemede kalır. Takip öncesi eksik geçmiş “Kayıt yok” görünür; o ayın toplamını elle tamamlayabilirsin.</p>
      </> : null}
      <SimpleModal open={planOpen} title="Aylık birikim planı" onClose={() => { if (!busy) setPlanOpen(false) }}>
        <form onSubmit={event => void savePlan(event)} className="space-y-4">
          <label className="block text-sm font-semibold">Aylık miktar ({unit})<Input className="mt-1 min-h-11" inputMode="decimal" value={monthlyAmount} onChange={event => setMonthlyAmount(event.target.value)} required /></label>
          {!plans.length ? <label className="block text-sm font-semibold">Başlangıç ayı<Input className="mt-1 min-h-11" type="month" value={startsOn} min="1900-01" max={currentMonth.slice(0, 7)} onChange={event => setStartsOn(event.target.value)} required /></label> : <p className="text-sm text-ink-muted">Değişiklik bu aydan itibaren geçerli olur. Önceki ayların hedefleri korunur.</p>}
          <label className="block text-sm font-semibold">Gerçekleşen miktar<Select className="mt-1 min-h-11" value={source} onChange={event => setSource(event.target.value as typeof source)}>
            {goal.value_type !== 'TRY' ? <option value="gold_buys">Altın defterindeki tüm {unit} alımları</option> : null}
            <option value="manual">Her ay elle gireceğim</option>
          </Select></label>
          <p className="text-xs text-ink-muted">Bu takip, birikim ve hesap bakiyelerini değiştirmez.</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy} className="min-h-11 w-full">{busy ? 'Kaydediliyor…' : 'Planı kaydet'}</Button>
        </form>
      </SimpleModal>
      <SimpleModal open={editing !== null} title="Aylık gerçekleşen miktar" onClose={() => { if (!busy) setEditing(null) }}>
        <form onSubmit={event => void saveActual(event)} className="space-y-4">
          <p className="text-sm text-ink-muted">{editing ? new Date(`${editing.month}T00:00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }) : ''} için toplam miktarı gir. Hiç biriktiremediysen 0 yaz.</p>
          <label className="block text-sm font-semibold">Gerçekleşen toplam ({editing?.plan.value_type === 'TRY' ? 'TL' : editing?.plan.value_type === 'gram_altin' ? 'gram' : 'çeyrek'})<Input className="mt-1 min-h-11" inputMode="decimal" required value={actual} onChange={event => setActual(event.target.value)} /></label>
          <p className="text-xs text-ink-muted">Elle girilen toplam, bu ayın alım kayıtlarından hesaplanan miktarın yerine geçer. Altın defterini ve bakiyelerini değiştirmez.</p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy} className="min-h-11 w-full">{busy ? 'Kaydediliyor…' : 'Miktarı kaydet'}</Button>
        </form>
      </SimpleModal>
    </div>
  )
}
