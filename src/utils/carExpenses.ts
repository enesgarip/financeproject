// Arabalarım — araç başına gider özeti. İki kaynağı tek merceğe indirir:
//   • Kartla yapılan giderler: card_expenses (car_id ile etiketli), tam tutar.
//   • Kart-dışı manuel giderler: car_expenses (nakit/banka).
// Bir gerçek harcama ya kartta ya kart-dışıdır; kaynaklar ayrık olduğu için
// toplarken mükerrer sayım olmaz. Bu SAF katman — para/borç yazmaz, yalnız okur.

import type { Car, CarExpense, CarPaymentMethod, CardExpense } from '../types/database'
import { roundTL, sumTL } from './money'

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
}

export type CarCategoryTotal = { category: string; total: number; share: number }

export type CarSummary = {
  car: Car
  total: number
  thisMonthTotal: number
  entryCount: number
  categories: CarCategoryTotal[]
  entries: CarLedgerEntry[]
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
    })
  }

  entries.sort((a, b) => (a.spentAt < b.spentAt ? 1 : a.spentAt > b.spentAt ? -1 : 0))
  return entries
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
    return {
      car,
      total,
      thisMonthTotal,
      entryCount: entries.length,
      categories: categoryBreakdown(entries, total),
      entries,
    }
  })
}
