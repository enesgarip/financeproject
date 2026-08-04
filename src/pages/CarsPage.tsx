import { Car as CarIcon, CreditCard, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
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
  insertCar,
  insertCarExpense,
  setCardExpenseCar,
  updateCar,
} from '../data/repositories/carsRepo'
import { fetchRecentCardExpenses } from '../data/repositories/cardsRepo'
import type { Car, CardExpense, CarPaymentMethod } from '../types/database'
import { CAR_EXPENSE_CATEGORIES, type CarSummary } from '../utils/carExpenses'
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
          <CarIcon className="size-4 text-primary" /> Araçlarım
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Her araç için giderleri ayrı takip et. Kart harcamaları borca aynen işler; buradaki takip
          yalnız araç başına dağılımı gösterir.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {cars.length > 0 ? (
          <ul className="flex flex-col gap-2">
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{car.name}</p>
                    {car.plate ? (
                      <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {car.plate}
                      </p>
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
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
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
  onSave: (fields: { name: string; plate: string | null }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(car.name)
  const [plate, setPlate] = useState(car.plate ?? '')
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2 sm:flex-row">
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Araç adı" className="sm:flex-[1.4]" />
      <Input value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="Plaka" className="sm:flex-1" />
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() => void onSave({ name: name.trim(), plate: plate.trim() || null })}
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
    })
    setSaving(false)
    if (!result.ok) {
      onError(result.error.message)
      return
    }
    setAmount('')
    setDescription('')
    await onAdded()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-primary" /> Kart-dışı gider ekle
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Nakit ya da bankadan ödediğin giderler (MTV, sigorta, nakit yakıt). Kartla ödediklerini
          aşağıdaki "Kart harcaması ata" bölümünden işaretle.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-foreground">
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
            <label className="block text-sm font-semibold text-foreground">
              Tarih
              <Input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="mt-1" />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <label className="block text-sm font-semibold text-foreground">
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
            <label className="block text-sm font-semibold text-foreground">
              Kategori
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1">
                {CAR_EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block text-sm font-semibold text-foreground">
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
          <label className="block text-sm font-semibold text-foreground">
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

  const carName = useMemo(() => new Map(cars.map((c) => [c.id, c.name])), [cars])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4 text-primary" /> Kart harcamasını araca ata
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Son kart harcamaların. Araca ait olanı işaretle — borç değişmez, yalnız araç dağılımına eklenir.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : expenses.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">Görüntülenecek kart harcaması yok.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {expenses.map((expense) => (
              <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{expense.description}</p>
                  <p className="truncate text-xs text-muted-foreground">
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
  const { car, total, thisMonthTotal, categories, entries } = summary

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{car.name}</CardTitle>
            {car.plate ? (
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{car.plate}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(total)}</p>
            <p className="text-xs text-muted-foreground">Bu ay {formatCurrency(thisMonthTotal)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {total === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Bu araca ait gider yok. Yukarıdan kart-dışı gider ekle ya da bir kart harcamasını ata.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {categories.map((cat) => (
                <div key={cat.category} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">{cat.category}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(cat.total)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(2, Math.round(cat.share * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-muted-foreground">Son giderler</p>
              <ul className="flex flex-col divide-y divide-border/50">
                {entries.slice(0, 12).map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{entry.description}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(entry.spentAt)} · {entry.category}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={entry.source === 'card' ? 'secondary' : 'outline'}>{entry.paymentLabel}</Badge>
                      <span className="w-24 text-right text-sm font-semibold tabular-nums text-foreground">
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
