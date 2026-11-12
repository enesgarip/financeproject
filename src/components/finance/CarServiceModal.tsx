import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/useAuth'
import { useCars } from '../../app/useCars'
import { useUsageFlow } from '../../hooks/useUsageFlow'
import { fetchTaggableCardExpenses } from '../../data/repositories/cardsRepo'
import { completeCarService, fetchCarServiceHistory } from '../../data/repositories/linkedWorkflowsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Car, CarReminder, CarServiceInput } from '../../types/database'
import { clearCarServiceAttempt, readCarServiceAttempt, saveCarServiceAttempt, type CarServiceAttempt } from '../../utils/carServiceAttempt'
import { suggestNextCarService } from '../../utils/carServicePlan'
import { dateInputValue, formatDate } from '../../utils/date'
import { parseNumber } from '../../utils/formatCurrency'
import { roundTL } from '../../utils/money'
import { SimpleModal } from '../SimpleModal'
import { Button } from '../ui/button'
import { Input, Select } from '../ui/input'
import { QueryError } from '../ui/query-error'

export function CarServiceModal({ reminder, car, onClose, onCompleted }: { reminder: CarReminder; car: Car; onClose: () => void; onCompleted: () => Promise<void> }) {
  const { user } = useAuth()
  const serviceUsage = useUsageFlow(user?.id, 'car-service', 'vehicle')
  const { formatAmount, maskText } = useBalancePrivacy()
  const cars = useCars()
  const [initial] = useState(() => {
    try { return { attempt: user ? readCarServiceAttempt(user.id, reminder.id) : null, error: '' } }
    catch { return { attempt: null, error: 'Önceki bakım işlemi okunamadı. Yeni kayıt girmeden tamamlanan işleri kontrol et.' } }
  })
  const [attempt, setAttempt] = useState<CarServiceAttempt | null>(initial.attempt)
  const [completedOn, setCompletedOn] = useState(initial.attempt?.input.completedOn ?? dateInputValue(new Date()))
  const [km, setKm] = useState(String(initial.attempt ? initial.attempt.input.odometerKm ?? '' : car.current_odometer_km ?? ''))
  const next = suggestNextCarService(reminder, completedOn, km ? Number(km) : null)
  const [nextDate, setNextDate] = useState(initial.attempt ? initial.attempt.input.nextDate ?? '' : next.nextDate ?? '')
  const [nextKm, setNextKm] = useState(String(initial.attempt ? initial.attempt.input.nextKm ?? '' : next.nextKm ?? ''))
  const [mode, setMode] = useState<CarServiceInput['expenseMode']>(initial.attempt?.input.expenseMode ?? 'none')
  const [expenseId, setExpenseId] = useState(initial.attempt?.input.existingExpenseId ?? '')
  const [amount, setAmount] = useState(String(initial.attempt?.input.amount ?? ''))
  const [payment, setPayment] = useState<CarServiceInput['paymentMethod']>(initial.attempt?.input.paymentMethod ?? 'nakit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initial.error)
  const inFlight = useRef(false)
  const completionTracked = useRef(false)
  const expenses = useQuery({ queryKey: ['service-expenses', user?.id, car.id], enabled: !!user && mode === 'card', queryFn: async () => {
    const result = await fetchTaggableCardExpenses(100)
    if (!result.ok) throw new Error(result.error.message)
    return result.data.filter(expense => !expense.car_id || expense.car_id === car.id)
  } })
  const manualExpenses = cars.data?.manualExpenses.filter(expense => expense.car_id === car.id) ?? []

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!user || inFlight.current || initial.error) return
    const input: CarServiceInput = attempt?.input ?? {
      reminderId: reminder.id, expectedUpdatedAt: reminder.updated_at, completedOn,
      expectedDueDate: reminder.due_date, expectedDueKm: reminder.due_odometer_km,
      odometerKm: km ? Number(km) : null, nextDate: nextDate || null, nextKm: nextKm ? Number(nextKm) : null,
      expenseMode: mode, existingExpenseId: mode === 'card' || mode === 'existing_manual' ? expenseId || null : null,
      amount: mode === 'manual' ? roundTL(parseNumber(amount)) : null, paymentMethod: payment,
    }
    if (!attempt && (input.completedOn > dateInputValue(new Date()) || (input.odometerKm !== null && (!Number.isInteger(input.odometerKm) || input.odometerKm < 0)) || (input.nextKm !== null && (!Number.isInteger(input.nextKm) || input.nextKm < 0)) || (mode === 'manual' && (!input.amount || !Number.isFinite(input.amount) || input.amount <= 0)) || ((mode === 'card' || mode === 'existing_manual') && !input.existingExpenseId))) { setError('Tarih, kilometre ve gider bilgilerini kontrol et.'); return }
    const pending = attempt ?? { id: crypto.randomUUID(), input }
    let completed = false
    let reportService: ReturnType<typeof serviceUsage.attempt> | undefined
    inFlight.current = true; setBusy(true); setError('')
    try {
      // Önce sakla: yenileme veya belirsiz yanıtta aynı isteği doğrula.
      saveCarServiceAttempt(user.id, pending)
      setAttempt(pending)
      if (!completionTracked.current) reportService = serviceUsage.attempt()
      const result = await completeCarService(pending.id, pending.input)
      if (!result.ok) {
        reportService?.('failed')
        reportService = undefined
        setError(result.error.message)
        if (result.error.code) { clearCarServiceAttempt(user.id, reminder.id); setAttempt(null) }
        return
      }
      completed = true
      if (!completionTracked.current) {
        completionTracked.current = true
        reportService?.('completed')
      }
      await onCompleted()
      clearCarServiceAttempt(user.id, reminder.id)
      onClose()
    } catch {
      if (!completed) reportService?.('failed')
      setError(completed ? 'İş tamamlandı, ancak listeler yenilenemedi. Sonucu doğrula ile aynı kaydı yeniden kontrol et.' : 'İşlem sonucu doğrulanamadı. Aynı bilgilerle tekrar dene; yeni gider oluşturulmaz.')
    }
    finally { inFlight.current = false; setBusy(false) }
  }

  return <SimpleModal busy={busy} open title="Bakımı veya yenilemeyi tamamla" onClose={() => { if (!busy) onClose() }}>
    <form onSubmit={event => void submit(event)} className="space-y-4">
      <p className="break-words font-semibold">{maskText(car.name)} · {maskText(reminder.title)}</p>
      {attempt ? <p role="status" className="text-sm text-warning">Önceki işlemin sonucu aynı bilgilerle doğrulanacak.</p> : null}
      <fieldset disabled={busy || !!attempt || !!initial.error} className="space-y-4">
        <label className="block text-sm font-semibold">Tamamlandığı tarih<Input type="date" className="mt-1" max={dateInputValue(new Date())} value={completedOn} required onChange={event => { setCompletedOn(event.target.value); if (event.target.value && reminder.repeat_months) setNextDate(suggestNextCarService(reminder, event.target.value, km ? Number(km) : null).nextDate ?? '') }} /></label>
        <label className="block text-sm font-semibold">İşlem kilometresi (opsiyonel)<Input className="mt-1" inputMode="numeric" value={km} onChange={event => { setKm(event.target.value); if (reminder.repeat_km) setNextKm(String(suggestNextCarService(reminder, completedOn, event.target.value ? Number(event.target.value) : null).nextKm ?? '')) }} /></label>
        <label className="block text-sm font-semibold">Bu işin gideri<Select className="mt-1" value={mode} onChange={event => { setMode(event.target.value as typeof mode); setExpenseId('') }}><option value="none">Gider kaydetmeden tamamla</option><option value="card">Mevcut hesap/kart harcamasını bağla</option><option value="existing_manual">Mevcut araç giderini seç</option><option value="manual">Hesapları etkilemeyen gider ekle</option></Select></label>
        {mode === 'card' ? expenses.isError ? <QueryError title="Harcama listesi yüklenemedi" onRetry={() => void expenses.refetch()} /> : <label className="block text-sm font-semibold">Mevcut harcama<Select required className="mt-1" value={expenseId} onChange={event => setExpenseId(event.target.value)}><option value="">Son 100 hareketten seç</option>{expenses.data?.map(expense => <option key={expense.id} value={expense.id}>{formatDate(expense.spent_at)} · {maskText(expense.description)} · {formatAmount(expense.amount)}</option>)}</Select></label> : null}
        {mode === 'existing_manual' ? <label className="block text-sm font-semibold">Kayıtlı araç gideri<Select required className="mt-1" value={expenseId} onChange={event => setExpenseId(event.target.value)}><option value="">Gider seç</option>{manualExpenses.map(expense => <option key={expense.id} value={expense.id}>{formatDate(expense.spent_at)} · {maskText(expense.description)} · {formatAmount(expense.amount)}</option>)}</Select></label> : null}
        {mode === 'manual' ? <><label className="block text-sm font-semibold">Gider tutarı (TL)<Input className="mt-1" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="block text-sm font-semibold">Ödeme yöntemi<Select className="mt-1" value={payment} onChange={event => setPayment(event.target.value as typeof payment)}><option value="nakit">Nakit</option><option value="banka">Banka</option><option value="diger">Diğer</option></Select></label><p className="text-xs text-ink-muted">Bu araç gideri yalnız raporlamadır; hesap bakiyeni değiştirmez. SMS/ekstrede varsa mevcut harcamayı seç.</p></> : null}
        <label className="block text-sm font-semibold">Sonraki tarih (opsiyonel)<Input type="date" className="mt-1" value={nextDate} onChange={event => setNextDate(event.target.value)} /></label>
        <label className="block text-sm font-semibold">Sonraki kilometre (opsiyonel)<Input className="mt-1" inputMode="numeric" value={nextKm} onChange={event => setNextKm(event.target.value)} /></label>
        <p className="text-xs text-ink-muted">Tekrar aralığı gerçekleşen tarih ve kilometreden önerilir. Sonraki iki alanı da boş bırakırsan hatırlatıcı kapanır.</p>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="min-h-11 w-full" disabled={busy || !!initial.error}>{busy ? 'Kaydediliyor…' : attempt ? 'Sonucu doğrula' : 'İşi tamamla'}</Button>
    </form>
  </SimpleModal>
}

export function CarServiceHistory() {
  const { user } = useAuth()
  const { maskText } = useBalancePrivacy()
  const query = useQuery({ queryKey: ['car-services', user?.id], enabled: !!user, queryFn: async () => {
    const result = await fetchCarServiceHistory()
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  } })
  if (query.isPending) return <p role="status">Tamamlanan işler yükleniyor…</p>
  if (query.isError) return <QueryError title="Tamamlanan işler yüklenemedi" message={query.error.message} onRetry={() => void query.refetch()} />
  return <div className="text-xs text-ink-muted"><p>Son 50 tamamlanan iş</p><ul className="divide-y divide-line">{query.data.map(row => <li className="py-3" key={row.id}><p className="break-words font-semibold text-ink">{maskText(row.title)}</p><p>{formatDate(row.completed_on)}{row.odometer_km !== null ? ` · ${row.odometer_km.toLocaleString('tr-TR')} km` : ''}</p></li>)}</ul>{!query.data.length ? <p className="py-3">Tamamlanan iş yok.</p> : null}</div>
}
