import { Bell, Car as CarIcon, Check, CreditCard, Fuel, Gauge, Pencil, Plus, Share2, Trash2, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCars, useInvalidateCars } from '../app/useCars'
import { useAuth } from '../auth/useAuth'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input, Select } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { useConfirmDialog } from '../components/ui/use-confirm-dialog'
import { useToast } from '../components/ui/toast'
import {
  deleteCar,
  deleteCarExpense,
  deleteCarReminder,
  insertCar,
  insertCarExpense,
  insertCarReminder,
  setCardExpenseCar,
  updateCar,
  updateCarReminder,
} from '../data/repositories/carsRepo'
import { fetchRecentCardExpenses } from '../data/repositories/cardsRepo'
import type { Car, CardExpense, CarPaymentMethod, CarReminder, CarReminderKind } from '../types/database'
import { CAR_EXPENSE_CATEGORIES, carReminderState, type CarSummary } from '../utils/carExpenses'
import { downloadCarTcoCard, renderCarTcoCard } from '../utils/carTcoCard'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { dateInputValue, formatDate } from '../utils/date'

const PAYMENT_OPTIONS: { value: CarPaymentMethod; label: string }[] = [
  { value: 'nakit', label: 'Nakit' },
  { value: 'banka', label: 'Banka' },
  { value: 'diger', label: 'Diğer' },
]

export function CarsPage() {
  const { user } = useAuth()
  const carsQuery = useCars()
  const invalidateCars = useInvalidateCars()
  const toast = useToast()
  const { confirm, confirmDialog } = useConfirmDialog()

  const cars = carsQuery.data?.cars ?? []
  const summaries = carsQuery.data?.summaries ?? []
  const reminders = carsQuery.data?.reminders ?? []

  const refresh = useCallback(async () => {
    await invalidateCars()
  }, [invalidateCars])

  if (carsQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {carsQuery.isError ? (
        <Alert variant="warning">Araç verisi yüklenemedi. Sayfayı yenilemeyi dene.</Alert>
      ) : null}

      <CarManager
        cars={cars}
        userId={user?.id}
        onChanged={refresh}
        onAdded={() => toast.success('Araç eklendi.')}
        onError={(m) => toast.error('Olmadı', m)}
        confirm={confirm}
      />

      {cars.length > 0 ? (
        <>
          <ManualExpenseForm
            cars={cars}
            userId={user?.id}
            onAdded={async () => {
              await refresh()
              toast.success('Araç gideri eklendi.')
            }}
            onError={(m) => toast.error('Gider eklenemedi', m)}
          />

          <CarRemindersPanel
            cars={cars}
            reminders={reminders}
            userId={user?.id}
            onChanged={refresh}
            onError={(m) => toast.error('Hatırlatıcı güncellenemedi', m)}
          />

          <CardTagging cars={cars} onChanged={refresh} onError={(m) => toast.error('Atanamadı', m)} />

          <section className="flex flex-col gap-4">
            {summaries.map((summary) => (
              <CarSummaryCard
                key={summary.car.id}
                summary={summary}
                onDeleteEntry={async (entryId) => {
                  const result = await deleteCarExpense(entryId)
                  if (!result.ok) {
                    toast.error('Silinemedi', result.error.message)
                    return
                  }
                  await refresh()
                }}
              />
            ))}
          </section>
        </>
      ) : null}

      {confirmDialog}
    </div>
  )
}

// ---- Araç yönetimi (ekle / düzenle / sil) -------------------------------------

function CarManager({
  cars,
  userId,
  onChanged,
  onAdded,
  onError,
  confirm,
}: {
  cars: Car[]
  userId: string | undefined
  onChanged: () => Promise<void>
  onAdded: () => void
  onError: (message: string) => void
  confirm: ReturnType<typeof useConfirmDialog>['confirm']
}) {
  const [name, setName] = useState('')
  const [plate, setPlate] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!userId || !name.trim() || saving) return
    setSaving(true)
    const result = await insertCar({
      user_id: userId,
      name: name.trim(),
      plate: plate.trim() || null,
      current_odometer_km: null,
      sort_order: cars.length,
      note: null,
    })
    setSaving(false)
    if (!result.ok) {
      onError(result.error.message)
      return
    }
    setName('')
    setPlate('')
    await onChanged()
    onAdded()
  }

  async function handleDelete(car: Car) {
    const ok = await confirm({
      title: `${car.name} silinsin mi?`,
      description:
        'Aracın manuel giderleri de silinir. Kartla yapılan harcamalar kalır; yalnız araç etiketi düşer.',
      confirmLabel: 'Sil',
      variant: 'destructive',
    })
    if (!ok) return
    const result = await deleteCar(car.id)
    if (!result.ok) {
      onError(result.error.message)
      return
    }
    await onChanged()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CarIcon className="size-4 text-primary" /> Araçlar
        </CardTitle>
        <p className="text-xs text-ink-muted">
          Her araç için giderleri ayrı takip et. Kart harcamaları borca aynen işler; buradaki takip
          yalnız araç başına dağılımı gösterir.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {cars.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line">
            {cars.map((car) =>
              editingId === car.id ? (
                <li key={car.id}>
                  <CarEditRow
                    car={car}
                    onCancel={() => setEditingId(null)}
                    onSave={async (fields) => {
                      const result = await updateCar(car.id, fields)
                      if (!result.ok) {
                        onError(result.error.message)
                        return
                      }
                      setEditingId(null)
                      await onChanged()
                    }}
                  />
                </li>
              ) : (
                <li
                  key={car.id}
                  className="flex items-center justify-between gap-2 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{car.name}</p>
                    {car.plate ? (
                      <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-muted">
                        {car.plate}
                      </p>
                    ) : null}
                    {car.current_odometer_km != null ? (
                      <p className="text-xs tabular-nums text-ink-muted">{car.current_odometer_km.toLocaleString('tr-TR')} km</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label="Düzenle" onClick={() => setEditingId(car.id)}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Sil"
                      onClick={() => void handleDelete(car)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-ink-muted">
            Henüz araç yok. İlk aracını ekleyip giderlerini takip etmeye başla.
          </p>
        )}

        <form onSubmit={handleAdd} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Araç adı (ör. Golf)"
            aria-label="Araç adı"
            className="sm:flex-[1.4]"
            required
          />
          <Input
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="Plaka (opsiyonel)"
            aria-label="Plaka"
            className="sm:flex-1"
          />
          <Button type="submit" disabled={!name.trim() || saving} className="shrink-0">
            <Plus /> {saving ? 'Ekleniyor...' : 'Ekle'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function CarEditRow({
  car,
  onSave,
  onCancel,
}: {
  car: Car
  onSave: (fields: { name: string; plate: string | null; current_odometer_km: number | null }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(car.name)
  const [plate, setPlate] = useState(car.plate ?? '')
  const [odometer, setOdometer] = useState(car.current_odometer_km?.toString() ?? '')
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2 sm:flex-row">
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Araç adı" className="sm:flex-[1.4]" />
      <Input value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="Plaka" className="sm:flex-1" />
      <Input value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" aria-label="Güncel kilometre" placeholder="Güncel km" className="sm:flex-1" />
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() => void onSave({ name: name.trim(), plate: plate.trim() || null, current_odometer_km: odometer.trim() ? Number.parseInt(odometer, 10) : null })}
        >
          Kaydet
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
    </div>
  )
}

// ---- Kart-dışı manuel gider ekle ---------------------------------------------

function ManualExpenseForm({
  cars,
  userId,
  onAdded,
  onError,
}: {
  cars: Car[]
  userId: string | undefined
  onAdded: () => Promise<void>
  onError: (message: string) => void
}) {
  const [carId, setCarId] = useState(cars[0]?.id ?? '')
  const [spentAt, setSpentAt] = useState(dateInputValue(new Date()))
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<string>(CAR_EXPENSE_CATEGORIES[0])
  const [paymentMethod, setPaymentMethod] = useState<CarPaymentMethod>('nakit')
  const [description, setDescription] = useState('')
  const [fuelLiters, setFuelLiters] = useState('')
  const [odometerKm, setOdometerKm] = useState('')
  const [saving, setSaving] = useState(false)

  const activeCarId = cars.some((c) => c.id === carId) ? carId : cars[0]?.id ?? ''
  const parsedAmount = parseNumber(amount)
  const canSubmit = Boolean(activeCarId) && parsedAmount > 0 && !saving

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!userId || !canSubmit) return
    setSaving(true)
    const result = await insertCarExpense({
      user_id: userId,
      car_id: activeCarId,
      spent_at: spentAt,
      amount: parsedAmount,
      category,
      payment_method: paymentMethod,
      description: description.trim(),
      note: null,
      fuel_liters: category === CAR_EXPENSE_CATEGORIES[0] && fuelLiters.trim() ? parseNumber(fuelLiters) : null,
      odometer_km: category === CAR_EXPENSE_CATEGORIES[0] && odometerKm.trim() ? Number.parseInt(odometerKm, 10) : null,
    })
    setSaving(false)
    if (!result.ok) {
      onError(result.error.message)
      return
    }
    setAmount('')
    setDescription('')
    setFuelLiters('')
    setOdometerKm('')
    const nextOdometer = Number.parseInt(odometerKm, 10)
    const activeCar = cars.find((car) => car.id === activeCarId)
    if (Number.isFinite(nextOdometer) && activeCar && (activeCar.current_odometer_km ?? 0) < nextOdometer) {
      await updateCar(activeCar.id, { current_odometer_km: nextOdometer })
    }
    await onAdded()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-primary" /> Kart-dışı gider ekle
        </CardTitle>
        <p className="text-xs text-ink-muted">
          Nakit ya da bankadan ödediğin giderler (MTV, sigorta, nakit yakıt). Kartla ödediklerini
          aşağıdaki "Kart harcaması ata" bölümünden işaretle.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">
              Araç
              <Select value={activeCarId} onChange={(e) => setCarId(e.target.value)} className="mt-1">
                {cars.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.name}
                    {car.plate ? ` · ${car.plate}` : ''}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm font-semibold text-ink">
              Tarih
              <Input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="mt-1" />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <label className="block text-sm font-semibold text-ink">
              TL tutar
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="mt-1 text-right font-mono tabular-nums"
                required
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Kategori
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
                {CAR_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm font-semibold text-ink">
              Ödeme
              <Select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as CarPaymentMethod)}
                className="mt-1"
              >
                {PAYMENT_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          {category === CAR_EXPENSE_CATEGORIES[0] ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-ink">
                Alınan litre
                <Input value={fuelLiters} onChange={(e) => setFuelLiters(e.target.value)} inputMode="decimal" placeholder="Ör. 42,5" className="mt-1" />
              </label>
              <label className="block text-sm font-semibold text-ink">
                Dolumdaki kilometre
                <Input value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} inputMode="numeric" placeholder="Ör. 82500" className="mt-1" />
              </label>
            </div>
          ) : null}
          <label className="block text-sm font-semibold text-ink">
            Açıklama (opsiyonel)
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kasko yenileme, MTV 1. taksit..."
              className="mt-1"
            />
          </label>
          <Button type="submit" variant="success" disabled={!canSubmit} className="w-full sm:w-auto sm:self-end">
            <Plus /> {saving ? 'Ekleniyor...' : 'Gideri kaydet'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ---- Kart harcamasını araca ata ----------------------------------------------

const REMINDER_KINDS: { value: CarReminderKind; label: string }[] = [
  { value: 'bakim', label: 'Bakım' }, { value: 'mtv', label: 'MTV' },
  { value: 'muayene', label: 'Muayene' }, { value: 'sigorta', label: 'Sigorta' },
  { value: 'kasko', label: 'Kasko' }, { value: 'lastik', label: 'Lastik' }, { value: 'diger', label: 'Diğer' },
]

function addMonthsIso(dateIso: string, months: number): string {
  const date = new Date(`${dateIso}T12:00:00`)
  date.setMonth(date.getMonth() + months)
  return dateInputValue(date)
}

function CarRemindersPanel({ cars, reminders, userId, onChanged, onError }: {
  cars: Car[]; reminders: CarReminder[]; userId?: string; onChanged: () => Promise<void>; onError: (message: string) => void
}) {
  const [carId, setCarId] = useState(cars[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CarReminderKind>('bakim')
  const [dueDate, setDueDate] = useState('')
  const [dueKm, setDueKm] = useState('')
  const [repeatMonths, setRepeatMonths] = useState('')
  const [repeatKm, setRepeatKm] = useState('')
  const [saving, setSaving] = useState(false)
  const todayIso = dateInputValue(new Date())
  const carsById = useMemo(() => new Map(cars.map((car) => [car.id, car])), [cars])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!userId || !title.trim() || (!dueDate && !dueKm) || saving) return
    setSaving(true)
    const result = await insertCarReminder({
      user_id: userId, car_id: carId, title: title.trim(), kind,
      due_date: dueDate || null, due_odometer_km: dueKm ? Number.parseInt(dueKm, 10) : null,
      repeat_months: repeatMonths ? Number.parseInt(repeatMonths, 10) : null,
      repeat_km: repeatKm ? Number.parseInt(repeatKm, 10) : null, note: null,
    })
    setSaving(false)
    if (!result.ok) return onError(result.error.message)
    setTitle(''); setDueDate(''); setDueKm(''); setRepeatMonths(''); setRepeatKm('')
    await onChanged()
  }

  async function complete(reminder: CarReminder) {
    if (reminder.repeat_months || reminder.repeat_km) {
      const result = await updateCarReminder(reminder.id, {
        due_date: reminder.due_date && reminder.repeat_months ? addMonthsIso(reminder.due_date, reminder.repeat_months) : reminder.due_date,
        due_odometer_km: reminder.due_odometer_km != null && reminder.repeat_km ? reminder.due_odometer_km + reminder.repeat_km : reminder.due_odometer_km,
      })
      if (!result.ok) return onError(result.error.message)
    } else {
      const result = await deleteCarReminder(reminder.id)
      if (!result.ok) return onError(result.error.message)
    }
    await onChanged()
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Bell className="size-4 text-primary" /> Bakım ve yenilemeler</CardTitle><p className="text-xs text-ink-muted">Tarih, kilometre veya ikisi birden yaklaşınca görünür; açık Web Push varsa tarihli işler 7 gün önce bildirilir.</p></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {reminders.length ? <ul className="grid gap-2 lg:grid-cols-2">{reminders.map((reminder) => {
          const car = carsById.get(reminder.car_id)
          if (!car) return null
          const state = carReminderState(reminder, car, todayIso)
          return <li key={reminder.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${state === 'overdue' ? 'border-destructive/40 bg-destructive/5' : state === 'due-soon' ? 'border-warning/40 bg-warning/5' : 'border-line-strong'}`}><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-bold">{reminder.title}</p><Badge variant={state === 'overdue' ? 'destructive' : state === 'due-soon' ? 'warning' : 'outline'}>{state === 'overdue' ? 'Gecikti' : state === 'due-soon' ? 'Yaklaşıyor' : 'Planlı'}</Badge></div><p className="truncate text-xs text-ink-muted">{car.name}{reminder.due_date ? ` · ${formatDate(reminder.due_date)}` : ''}{reminder.due_odometer_km != null ? ` · ${reminder.due_odometer_km.toLocaleString('tr-TR')} km` : ''}</p></div><div className="flex shrink-0 gap-1"><Button size="icon-sm" variant="ghost" aria-label="Tamamlandı" onClick={() => void complete(reminder)}><Check /></Button><Button size="icon-sm" variant="ghost" aria-label="Hatırlatıcıyı sil" onClick={async () => { const result = await deleteCarReminder(reminder.id); if (!result.ok) return onError(result.error.message); await onChanged() }}><Trash2 /></Button></div></li>
        })}</ul> : <p className="text-sm text-ink-muted">Henüz bakım veya yenileme hatırlatıcısı yok.</p>}
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={carId} onChange={(e) => setCarId(e.target.value)} aria-label="Hatırlatıcı aracı">{cars.map((car) => <option key={car.id} value={car.id}>{car.name}</option>)}</Select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Yağ değişimi, MTV..." required />
          <Select value={kind} onChange={(e) => setKind(e.target.value as CarReminderKind)}>{REMINDER_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Hedef tarih" />
          <Input value={dueKm} onChange={(e) => setDueKm(e.target.value)} inputMode="numeric" placeholder="Hedef km" />
          <Input value={repeatMonths} onChange={(e) => setRepeatMonths(e.target.value)} inputMode="numeric" placeholder="Kaç ayda bir?" />
          <Input value={repeatKm} onChange={(e) => setRepeatKm(e.target.value)} inputMode="numeric" placeholder="Kaç km'de bir?" />
          <Button type="submit" disabled={!title.trim() || (!dueDate && !dueKm) || saving}><Plus /> {saving ? 'Ekleniyor...' : 'Hatırlat'}</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function CardTagging({
  cars,
  onChanged,
  onError,
}: {
  cars: Car[]
  onChanged: () => Promise<void>
  onError: (message: string) => void
}) {
  const [expenses, setExpenses] = useState<CardExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await fetchRecentCardExpenses(40)
    if (result.ok) setExpenses(result.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function assign(expenseId: string, carId: string) {
    setBusyId(expenseId)
    const result = await setCardExpenseCar(expenseId, carId || null)
    setBusyId(null)
    if (!result.ok) {
      onError(result.error.message)
      return
    }
    // Yerel listeyi de güncelle ki seçim anında yansısın.
    setExpenses((rows) => rows.map((r) => (r.id === expenseId ? { ...r, car_id: carId || null } : r)))
    await onChanged()
  }

  async function saveFuel(event: React.FormEvent<HTMLFormElement>, expense: CardExpense) {
    event.preventDefault()
    if (!expense.car_id) return
    const form = new FormData(event.currentTarget)
    const litersText = String(form.get('liters') ?? '')
    const odometerText = String(form.get('odometer') ?? '')
    const liters = litersText.trim() ? parseNumber(litersText) : null
    const odometerKm = odometerText.trim() ? Number.parseInt(odometerText, 10) : null
    setBusyId(expense.id)
    const result = await setCardExpenseCar(expense.id, expense.car_id, { liters, odometerKm })
    if (result.ok && odometerKm != null) {
      const car = cars.find((row) => row.id === expense.car_id)
      if (car && (car.current_odometer_km ?? 0) < odometerKm) await updateCar(car.id, { current_odometer_km: odometerKm })
    }
    setBusyId(null)
    if (!result.ok) return onError(result.error.message)
    setExpenses((rows) => rows.map((row) => row.id === expense.id ? { ...row, fuel_liters: liters, odometer_km: odometerKm } : row))
    await onChanged()
  }

  const carName = useMemo(() => new Map(cars.map((c) => [c.id, c.name])), [cars])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4 text-primary" /> Kart harcamasını araca ata
        </CardTitle>
        <p className="text-xs text-ink-muted">
          Son kart harcamaların. Araca ait olanı işaretle — borç değişmez, yalnız araç dağılımına eklenir.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : expenses.length === 0 ? (
          <p className="py-2 text-center text-sm text-ink-muted">Görüntülenecek kart harcaması yok.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex flex-col gap-2 py-2">
                <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{expense.description}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {formatDate(expense.spent_at)} · {formatCurrency(expense.amount)}
                    {expense.car_id ? (
                      <> · <span className="text-primary">{carName.get(expense.car_id) ?? 'Araç'}</span></>
                    ) : null}
                  </p>
                </div>
                <Select
                  value={expense.car_id ?? ''}
                  disabled={busyId === expense.id}
                  onChange={(e) => void assign(expense.id, e.target.value)}
                  className="w-36 shrink-0"
                  aria-label={`${expense.description} için araç ata`}
                >
                  <option value="">Araç yok</option>
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                    </option>
                  ))}
                </Select>
                </div>
                {expense.car_id && (expense.category === CAR_EXPENSE_CATEGORIES[0] || expense.fuel_liters != null) ? (
                  <form onSubmit={(event) => void saveFuel(event, expense)} className="grid grid-cols-[1fr_1fr_auto] gap-2 pl-2 sm:max-w-lg sm:self-end">
                    <Input name="liters" defaultValue={expense.fuel_liters ?? ''} inputMode="decimal" placeholder="Litre" aria-label={`${expense.description} litre`} />
                    <Input name="odometer" defaultValue={expense.odometer_km ?? ''} inputMode="numeric" placeholder="Kilometre" aria-label={`${expense.description} kilometre`} />
                    <Button size="sm" type="submit" disabled={busyId === expense.id}><Fuel /> Kaydet</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---- Araç başına özet ---------------------------------------------------------

function CarSummaryCard({
  summary,
  onDeleteEntry,
}: {
  summary: CarSummary
  onDeleteEntry: (entryId: string) => Promise<void>
}) {
  const { car, total, thisMonthTotal, yearTotal, previousYearTotal, costPerDay, fuel, categories, entries } = summary
  const currentYear = new Date().getFullYear()
  const fuelTrendMaxCost = fuel.months.reduce((max, row) => Math.max(max, row.cost), 1)
  // ₺/lt serisi min-max normalize edilir: pompa fiyatı dar bantta gezer
  // (42→45), 0-tabanlı ölçek farkı görünmez yapardı. Kesin değer yandaki cümlede.
  const unitPriceView = fuel.unitPrices.slice(-8)
  const unitPriceMin = unitPriceView.reduce((min, row) => Math.min(min, row.pricePerLiter), Infinity)
  const unitPriceMax = unitPriceView.reduce((max, row) => Math.max(max, row.pricePerLiter), 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{car.name}</CardTitle>
            {car.plate ? (
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{car.plate}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tabular-nums text-ink">{formatCurrency(total)}</p>
            <p className="text-xs text-ink-muted">Bu ay {formatCurrency(thisMonthTotal)}</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => downloadCarTcoCard(renderCarTcoCard(summary, currentYear), currentYear)}><Share2 /> Karneni indir</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-4 text-center text-sm text-ink-muted">
            Bu araca ait gider yok. Yukarıdan kart-dışı gider ekle ya da bir kart harcamasını ata.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-page p-3"><p className="text-xs text-ink-muted">{currentYear} TCO</p><p className="font-bold tabular-nums">{formatCurrency(yearTotal)}</p></div>
              <div className="rounded-xl bg-page p-3"><p className="text-xs text-ink-muted">Günlük maliyet</p><p className="font-bold tabular-nums">{formatCurrency(costPerDay)}</p></div>
              <div className="rounded-xl bg-page p-3"><p className="text-xs text-ink-muted">Önceki yıl</p><p className="font-bold tabular-nums">{formatCurrency(previousYearTotal)}</p></div>
              <div className="rounded-xl bg-page p-3"><p className="text-xs text-ink-muted">Yakıt / km</p><p className="font-bold tabular-nums">{fuel.costPerKm == null ? '—' : formatCurrency(fuel.costPerKm)}</p></div>
            </div>

            {fuel.fillupCount > 0 ? (
              <div className="rounded-xl border border-line-strong p-3">
                <div className="mb-3 flex items-center gap-2"><Gauge className="size-4 text-primary" /><p className="text-sm font-bold">Yakıt karnesi</p></div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><p className="text-xs text-ink-muted">Dolum</p><p className="font-semibold">{fuel.fillupCount}</p></div>
                  <div><p className="text-xs text-ink-muted">Ölçülen km</p><p className="font-semibold tabular-nums">{fuel.measuredDistanceKm.toLocaleString('tr-TR')}</p></div>
                  <div><p className="text-xs text-ink-muted">L / 100 km</p><p className="font-semibold tabular-nums">{fuel.litersPer100Km ?? '—'}</p></div>
                  <div><p className="text-xs text-ink-muted">TL / km</p><p className="font-semibold tabular-nums">{fuel.costPerKm ?? '—'}</p></div>
                </div>
                {fuel.lastFillup ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    Son dolum {formatCurrency(fuel.lastFillup.pricePerLiter)}/lt
                    {fuel.lastVsMedianPct != null
                      ? Math.abs(fuel.lastVsMedianPct) <= 2
                        ? ' — 3 ay medyanıyla aynı seviyede'
                        : ` — 3 ay medyanının %${Math.abs(fuel.lastVsMedianPct)} ${fuel.lastVsMedianPct > 0 ? 'üstünde' : 'altında'}`
                      : ''}
                  </p>
                ) : null}
                {unitPriceView.length > 1 ? (
                  <div className="mt-2 flex items-end gap-1" aria-label="₺/litre birim fiyat trendi">
                    {unitPriceView.map((row, index) => (
                      <div key={`${row.date}-${index}`} className="flex flex-1 flex-col items-center gap-1">
                        {index === unitPriceView.length - 1 ? (
                          <span className="text-[10px] tabular-nums text-ink-muted">{formatCurrency(row.pricePerLiter)}/lt</span>
                        ) : null}
                        <div
                          className="w-full rounded-t bg-success/60"
                          style={{
                            height: `${Math.round(
                              10 +
                                (unitPriceMax > unitPriceMin
                                  ? ((row.pricePerLiter - unitPriceMin) / (unitPriceMax - unitPriceMin)) * 38
                                  : 19),
                            )}px`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                {fuel.months.length > 1 ? <div className="mt-3 flex items-end gap-2" aria-label="Aylık yakıt trendi">{fuel.months.slice(0, 6).reverse().map((month) => <div key={month.month} className="flex flex-1 flex-col items-center gap-1"><span className="text-[10px] tabular-nums text-ink-muted">{formatCurrency(month.cost)}</span><div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(8, (month.cost / fuelTrendMaxCost) * 64)}px` }} /><span className="text-[10px] text-ink-muted">{month.month.slice(5)}</span></div>)}</div> : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              {categories.map((cat) => (
                <div key={cat.category} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink">{cat.category}</span>
                    <span className="tabular-nums text-ink-muted">{formatCurrency(cat.total)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-page">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(2, Math.round(cat.share * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-ink-muted">Son giderler</p>
              <ul className="flex flex-col divide-y divide-line">
                {entries.slice(0, 12).map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{entry.description}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {formatDate(entry.spentAt)} · {entry.category}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={entry.source === 'card' ? 'secondary' : 'outline'}>{entry.paymentLabel}</Badge>
                      <span className="w-24 text-right text-sm font-semibold tabular-nums text-ink">
                        {formatCurrency(entry.amount)}
                      </span>
                      {entry.source === 'manual' ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Gideri sil"
                          onClick={() => void onDeleteEntry(entry.id.replace(/^manual:/, ''))}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
