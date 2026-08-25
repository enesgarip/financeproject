// Arabalarım — araç başına gider özeti. İki kaynağı tek merceğe indirir:
//   • Kartla yapılan giderler: card_expenses (car_id ile etiketli), tam tutar.
//   • Kart-dışı manuel giderler: car_expenses (nakit/banka).
// Bir gerçek harcama ya kartta ya kart-dışıdır; kaynaklar ayrık olduğu için
// toplarken mükerrer sayım olmaz. Bu SAF katman — para/borç yazmaz, yalnız okur.

import type { Car, CarExpense, CarPaymentMethod, CardExpense, CarReminder } from '../types/database'
import { roundTL, sumTL } from './money'
import { median } from './spendingStats'

export type CarLedgerSource = 'card' | 'manual'

/** Araç gideri kategorileri (nakit ve kart giderleri ortak bu seti kullanır). */
export const CAR_EXPENSE_CATEGORIES = [
  'Yakıt',
  'Bakım/Servis',
  'MTV/Vergi',
  'Sigorta/Kasko',
  'Muayene',
  'Lastik',
  'Otopark/Geçiş',
  'Ceza',
  'Yıkama',
  'Diğer',
] as const

export type CarExpenseCategory = (typeof CAR_EXPENSE_CATEGORIES)[number]

const PAYMENT_LABELS: Record<CarPaymentMethod, string> = {
  nakit: 'Nakit',
  banka: 'Banka',
  diger: 'Diğer',
}

export function carPaymentLabel(method: CarPaymentMethod): string {
  return PAYMENT_LABELS[method] ?? 'Diğer'
}

/** Ay eşleştirmesi için YYYY-MM anahtarı (tarih 'YYYY-MM-DD' ya da ISO olabilir). */
function monthKey(dateish: string): string {
  return (dateish ?? '').slice(0, 7)
}

export type CarLedgerEntry = {
  id: string
  carId: string
  source: CarLedgerSource
  spentAt: string
  amount: number
  category: string
  description: string
  /** Kullanıcıya gösterilecek ödeme etiketi: 'Kart' | 'Nakit' | 'Banka' | 'Diğer'. */
  paymentLabel: string
  fuelLiters: number | null
  odometerKm: number | null
}

export type CarCategoryTotal = { category: string; total: number; share: number }

export type CarSummary = {
  car: Car
  total: number
  thisMonthTotal: number
  yearTotal: number
  previousYearTotal: number
  costPerDay: number
  entryCount: number
  categories: CarCategoryTotal[]
  entries: CarLedgerEntry[]
  fuel: CarFuelSummary
}

export type CarFuelMonth = {
  month: string
  cost: number
  liters: number
  distanceKm: number
  litersPer100Km: number | null
  costPerKm: number | null
}

export type CarFuelSummary = {
  fillupCount: number
  totalLiters: number
  measuredDistanceKm: number
  litersPer100Km: number | null
  costPerKm: number | null
  months: CarFuelMonth[]
  /** Dolum bazlı ₺/lt serisi (eski→yeni). Fişte yakıt-dışı kalem varsa şişer — bilinçli kabul. */
  unitPrices: Array<{ date: string; pricePerLiter: number }>
  lastFillup: { date: string; pricePerLiter: number } | null
  /** Son 90 günün ₺/lt medyanı; pencerede 2'den az fiyatlı dolum varsa null (kıyas uydurulmaz). */
  medianPricePerLiter3m: number | null
  /** Son dolumun medyana göre yüzde farkı (tam sayı; +üstünde/−altında); medyan yoksa null. */
  lastVsMedianPct: number | null
}

/** İki kaynağı ortak girdi listesine indirger (tarihe göre yeni→eski sıralı). */
export function buildCarLedgerEntries(
  manual: CarExpense[],
  taggedCard: CardExpense[],
): CarLedgerEntry[] {
  const entries: CarLedgerEntry[] = []

  for (const row of manual) {
    entries.push({
      id: `manual:${row.id}`,
      carId: row.car_id,
      source: 'manual',
      spentAt: row.spent_at,
      amount: roundTL(row.amount),
      category: row.category || 'Diğer',
      description: row.description?.trim() || row.category || 'Araç gideri',
      paymentLabel: carPaymentLabel(row.payment_method),
      fuelLiters: row.fuel_liters ?? null,
      odometerKm: row.odometer_km ?? null,
    })
  }

  for (const row of taggedCard) {
    if (!row.car_id) continue
    entries.push({
      id: `card:${row.id}`,
      carId: row.car_id,
      source: 'card',
      spentAt: row.spent_at,
      amount: roundTL(row.amount),
      category: row.category || 'Diğer',
      description: row.description?.trim() || row.category || 'Kart harcaması',
      paymentLabel: 'Kart',
      fuelLiters: row.fuel_liters ?? null,
      odometerKm: row.odometer_km ?? null,
    })
  }

  entries.sort((a, b) => (a.spentAt < b.spentAt ? 1 : a.spentAt > b.spentAt ? -1 : 0))
  return entries
}

/**
 * Yakıt özeti: L/100km ve ₺/km yalnız ÖLÇÜLEBİLEN aralıklardan hesaplanır
 * (iki artan odometre okuması arası). Tank-to-tank yöntem: A→B mesafesi,
 * B'de alınan yakıtla kat edilmiş sayılır — bu yüzden ilk (temel) dolumun
 * litresi hiçbir aralığa girmez, doğrusu bu.
 *
 * Bulgu (Faz F): odometresiz ARA dolumun litresi hiçbir yere yazılmıyordu ama
 * bir sonraki ölçümde mesafe TAMAMI alınıyordu → aralığa giren yakıt eksik,
 * L/100km sistematik olarak DÜŞÜK çıkıyordu (5 L'lik ara dolum tüketimi %20
 * yanlış gösterebilir). Artık bekleyen litre/masraf, aralığı kapatan ölçüme
 * taşınır; hem litre hem mesafe aynı aralığa ait olur. Aynı düzeltme
 * odometresi GERİLEMİŞ (hatalı okunmuş) satır için de geçerlidir.
 */
function buildFuelSummary(entries: CarLedgerEntry[], today: Date = new Date()): CarFuelSummary {
  const fillups = entries
    .filter((entry) => entry.fuelLiters != null && entry.fuelLiters > 0)
    .sort((a, b) => a.spentAt.localeCompare(b.spentAt))
  const measured = new Map<string, { costs: number[]; measuredCosts: number[]; liters: number; distanceKm: number }>()
  let previousOdometer: number | null = null
  // Aralığı kapatan ölçümü bekleyen ara dolumlar.
  let pendingLiters = 0
  let pendingCosts: number[] = []

  for (const fillup of fillups) {
    const month = monthKey(fillup.spentAt)
    const row = measured.get(month) ?? { costs: [], measuredCosts: [], liters: 0, distanceKm: 0 }
    row.costs.push(fillup.amount)
    const odometer = fillup.odometerKm
    // Koşul YERİNDE yazılır (ara değişkene alınmaz) ki TS `previousOdometer`ı
    // bloğun içinde non-null daraltabilsin.
    if (odometer != null && previousOdometer != null && odometer > previousOdometer) {
      row.liters += (fillup.fuelLiters ?? 0) + pendingLiters
      row.distanceKm += odometer - previousOdometer
      row.measuredCosts.push(fillup.amount, ...pendingCosts)
      pendingLiters = 0
      pendingCosts = []
    } else if (previousOdometer != null) {
      // Ölçüm zinciri kurulu ama bu satır aralığı kapatmıyor: yakıtı bir SONRAKİ
      // ölçülen aralıkta yakıldı. (previousOdometer == null = temel dolum;
      // onun litresi bilinçli olarak hiçbir aralığa yazılmaz.)
      pendingLiters += fillup.fuelLiters ?? 0
      pendingCosts.push(fillup.amount)
    }
    if (odometer != null && (previousOdometer == null || odometer > previousOdometer)) {
      previousOdometer = odometer
    }
    measured.set(month, row)
  }

  const months = Array.from(measured.entries()).map(([month, row]) => {
    const cost = sumTL(row.costs)
    const measuredCost = sumTL(row.measuredCosts)
    return {
      month,
      cost,
      liters: row.liters,
      distanceKm: row.distanceKm,
      litersPer100Km: row.distanceKm > 0 ? roundTL((row.liters * 100) / row.distanceKm) : null,
      costPerKm: row.distanceKm > 0 ? roundTL(measuredCost / row.distanceKm) : null,
      measuredCost,
    }
  }).sort((a, b) => b.month.localeCompare(a.month))

  const measuredDistanceKm = months.reduce((total, row) => total + row.distanceKm, 0)
  const totalLiters = fillups.reduce((total, row) => total + (row.fuelLiters ?? 0), 0)
  const measuredLiters = months.reduce((total, row) => total + row.liters, 0)
  const measuredCost = sumTL(months.map((row) => row.measuredCost))

  // ₺/lt bir ORAN (para karşılaştırması değil) — roundTL yalnız 2 hane display
  // precision için, L189-190'daki litersPer100Km/costPerKm konvansiyonuyla aynı;
  // money.ts'in equalsTL/greaterThanTL'ine bağlanmaz.
  const unitPrices = fillups
    .filter((fillup) => fillup.amount > 0 && (fillup.fuelLiters ?? 0) > 0)
    .map((fillup) => ({ date: fillup.spentAt, pricePerLiter: roundTL(fillup.amount / (fillup.fuelLiters ?? 1)) }))
  const lastFillup = unitPrices.at(-1) ?? null
  // 90 gün penceresi; tarih stringleri date-only dilimle lexicographic kıyaslanır.
  const cutoffIso = new Date(today.getTime() - 90 * 86_400_000).toLocaleDateString('sv-SE')
  const windowPrices = unitPrices.filter((row) => row.date.slice(0, 10) >= cutoffIso).map((row) => row.pricePerLiter)
  const medianPricePerLiter3m = windowPrices.length >= 2 ? roundTL(median(windowPrices)) : null
  const lastVsMedianPct =
    lastFillup && medianPricePerLiter3m != null && medianPricePerLiter3m > 0
      ? Math.round(((lastFillup.pricePerLiter - medianPricePerLiter3m) / medianPricePerLiter3m) * 100)
      : null

  return {
    fillupCount: fillups.length,
    totalLiters,
    measuredDistanceKm,
    litersPer100Km: measuredDistanceKm > 0 ? roundTL((measuredLiters * 100) / measuredDistanceKm) : null,
    costPerKm: measuredDistanceKm > 0 ? roundTL(measuredCost / measuredDistanceKm) : null,
    months,
    unitPrices,
    lastFillup,
    medianPricePerLiter3m,
    lastVsMedianPct,
  }
}

function categoryBreakdown(entries: CarLedgerEntry[], total: number): CarCategoryTotal[] {
  const byCategory = new Map<string, number[]>()
  for (const entry of entries) {
    const bucket = byCategory.get(entry.category) ?? []
    bucket.push(entry.amount)
    byCategory.set(entry.category, bucket)
  }

  const rows: CarCategoryTotal[] = Array.from(byCategory.entries()).map(([category, amounts]) => {
    const catTotal = sumTL(amounts)
    return { category, total: catTotal, share: total > 0 ? catTotal / total : 0 }
  })

  rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.category.localeCompare(b.category, 'tr')))
  return rows
}

/**
 * Her araç için toplam, bu-ay toplamı, kategori kırılımı ve birleşik giriş
 * listesini üretir. `today` test edilebilirlik için enjekte edilir.
 */
export function buildCarSummaries(
  cars: Car[],
  manual: CarExpense[],
  taggedCard: CardExpense[],
  today: Date = new Date(),
): CarSummary[] {
  const allEntries = buildCarLedgerEntries(manual, taggedCard)
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const currentYear = String(today.getFullYear())
  const previousYear = String(today.getFullYear() - 1)
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const elapsedDays = Math.max(1, Math.floor((today.getTime() - startOfYear.getTime()) / 86_400_000) + 1)

  const byCar = new Map<string, CarLedgerEntry[]>()
  for (const entry of allEntries) {
    const bucket = byCar.get(entry.carId) ?? []
    bucket.push(entry)
    byCar.set(entry.carId, bucket)
  }

  return cars.map((car) => {
    const entries = byCar.get(car.id) ?? []
    const total = sumTL(entries.map((e) => e.amount))
    const thisMonthTotal = sumTL(
      entries.filter((e) => monthKey(e.spentAt) === currentMonth).map((e) => e.amount),
    )
    const yearTotal = sumTL(entries.filter((e) => e.spentAt.startsWith(currentYear)).map((e) => e.amount))
    const previousYearTotal = sumTL(entries.filter((e) => e.spentAt.startsWith(previousYear)).map((e) => e.amount))
    return {
      car,
      total,
      thisMonthTotal,
      yearTotal,
      previousYearTotal,
      costPerDay: roundTL(yearTotal / elapsedDays),
      entryCount: entries.length,
      categories: categoryBreakdown(entries, total),
      entries,
      fuel: buildFuelSummary(entries, today),
    }
  })
}

export type CarReminderState = 'overdue' | 'due-soon' | 'upcoming'

export function carReminderState(
  reminder: CarReminder,
  car: Car,
  todayIso: string,
): CarReminderState {
  const dueByDate = reminder.due_date != null && reminder.due_date < todayIso
  const dueByKm = reminder.due_odometer_km != null
    && car.current_odometer_km != null
    && car.current_odometer_km >= reminder.due_odometer_km
  if (dueByDate || dueByKm) return 'overdue'

  const soonDate = new Date(`${todayIso}T00:00:00`)
  soonDate.setDate(soonDate.getDate() + 30)
  const within30Days = reminder.due_date != null && reminder.due_date <= soonDate.toISOString().slice(0, 10)
  const within1000Km = reminder.due_odometer_km != null
    && car.current_odometer_km != null
    && reminder.due_odometer_km - car.current_odometer_km <= 1000
  return within30Days || within1000Km ? 'due-soon' : 'upcoming'
}
