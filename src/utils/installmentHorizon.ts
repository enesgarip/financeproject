/**
 * Taksit ufku (saf): karar anında ve rahatlama yönünde iki soruya cevap verir.
 *
 *  - buildPlannedInstallmentHint → "Bu planla aylık taksit yükün ₺X → ₺Y olur"
 *    (taksit SAYISININ seçildiği iki forma gider: niyet + sonradan-taksitlendir).
 *  - findInstallmentReliefs → "Ekim'de 2 taksit bitiyor → Kasım'dan itibaren
 *    aylık yük ₺2.400 azalır" (taksit takvimi paneli).
 *
 * Yalnız 'scheduled' satırlar sayılır — cardInstallmentCalendar ile aynı
 * gerekçe: 'posted' zaten kartın dönem-içi/ekstre borcunda. Dil "taksit yükü"
 * der, "nakit yükü" DEMEZ: obligations.ts kart taksitinin nakit etkisini
 * bilinçli 0 sayar (ekstre ödemesiyle çıkar), bu ufuk o muhasebeye karışmaz.
 */
import type { CardInstallment } from '../types/database'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { roundTL, sumTL } from './money'

export type PlannedInstallmentHint = {
  /** Yeni planın aya düşen payı (toplam / taksit sayısı). */
  perMonth: number
  /** Önümüzdeki ayın halihazırda planlı taksit yükü. */
  baseMonthly: number
  /** Plan eklenirse önümüzdeki ayın yükü. */
  newMonthly: number
  months: number
}

export type InstallmentRelief = {
  /** Planın SON taksitinin düştüğü ay (ayın 1'i, ISO). */
  monthKey: string
  monthLabel: string
  /** O ay son taksitini ödeyen plan sayısı. */
  count: number
  /** Sonraki aydan itibaren aylık yükten düşen toplam. */
  monthlyDrop: number
}

function monthKeyOf(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function labelOf(monthKey: string): string {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${monthKey}T00:00:00`))
}

/** Önümüzdeki (bir sonraki) ayın planlı taksit toplamı. */
export function nextMonthInstallmentLoad(installments: CardInstallment[], today: Date = new Date()): number {
  const nextMonthKey = dateInputValue(addMonths(startOfMonth(today), 1)).slice(0, 7)
  return roundTL(
    sumTL(
      installments
        .filter((item) => item.status === 'scheduled' && item.due_month.slice(0, 7) === nextMonthKey)
        .map((item) => item.amount),
    ),
  )
}

/**
 * Karar anı ipucu. Taban bilinçli olarak ÖNÜMÜZDEKİ ay: içinde bulunulan ayın
 * taksitleri kısmen ödenmiş/kesilmiş olabilir, yeni planın ilk taksiti de
 * çoğunlukla bir sonraki ekstreye düşer. Tek çekimde (count ≤ 1) ipucu yok.
 */
export function buildPlannedInstallmentHint(
  installments: CardInstallment[],
  plan: { amount: number | null | undefined; count: number },
  today: Date = new Date(),
): PlannedInstallmentHint | null {
  if (plan.count <= 1 || !plan.amount || plan.amount <= 0) return null
  const perMonth = roundTL(plan.amount / plan.count)
  const baseMonthly = nextMonthInstallmentLoad(installments, today)
  return { perMonth, baseMonthly, newMonthly: roundTL(baseMonthly + perMonth), months: plan.count }
}

/**
 * Yaklaşan taksit bitişleri. Planlar `card_expense_id` ile gruplanır (bağı
 * olmayan satır kendi başına plandır); planın son 'scheduled' ayı bitiş ayıdır,
 * düşen aylık yük son ayın satır toplamıdır. Geçmiş aylar elenir.
 */
export function findInstallmentReliefs(
  installments: CardInstallment[],
  options: { horizonMonths?: number; today?: Date } = {},
): InstallmentRelief[] {
  const today = options.today ?? new Date()
  const horizonMonths = options.horizonMonths ?? 12
  const currentMonthKey = dateInputValue(startOfMonth(today))
  const horizonEndKey = dateInputValue(addMonths(startOfMonth(today), horizonMonths))

  const byPlan = new Map<string, CardInstallment[]>()
  for (const item of installments) {
    if (item.status !== 'scheduled') continue
    const key = item.card_expense_id ?? `row:${item.id}`
    const group = byPlan.get(key)
    if (group) group.push(item)
    else byPlan.set(key, [item])
  }

  const byMonth = new Map<string, InstallmentRelief>()
  for (const group of byPlan.values()) {
    const lastMonthKey = monthKeyOf(
      group.reduce((max, item) => (item.due_month > max ? item.due_month : max), group[0].due_month),
    )
    if (lastMonthKey < currentMonthKey || lastMonthKey >= horizonEndKey) continue

    const monthlyDrop = sumTL(group.filter((item) => monthKeyOf(item.due_month) === lastMonthKey).map((item) => item.amount))
    const existing = byMonth.get(lastMonthKey)
    if (existing) {
      existing.count += 1
      existing.monthlyDrop = roundTL(sumTL([existing.monthlyDrop, monthlyDrop]))
    } else {
      byMonth.set(lastMonthKey, {
        monthKey: lastMonthKey,
        monthLabel: labelOf(lastMonthKey),
        count: 1,
        monthlyDrop: roundTL(monthlyDrop),
      })
    }
  }

  return Array.from(byMonth.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey))
}
