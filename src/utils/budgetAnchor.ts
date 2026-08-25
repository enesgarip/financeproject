/**
 * Bütçe limit çıpası (saf) — hedef tutar çıpasının (goalTargetAnchor) bütçe
 * simetriği. Limit bir KURALA bağlanabilir; çıpalı satırda limit_amount 0
 * saklanır ve burada, okuma anında türetilir:
 *
 *   avg_spend  → satırın ayından önceki 3 TAM ayın kategori ortalaması × çarpan
 *   salary_pct → güncel maaşın yüzdesi
 *
 * Ortalama satırın KENDİ ayına göredir: geçmiş aylar değişmediği için ay içinde
 * stabil, geçmiş bütçe satırları tarihsel olarak doğru. Boş ay 0 sayılır —
 * kural öngörülebilir kalsın (medyan/örnek eleme ÖNERİ tarafının işi).
 *
 * Öneri tarafı (#159 deseninin bire biri): uygulama kullanıcının sayısını
 * kendiliğinden DEĞİŞTİRMEZ; bayat MANUAL limit için son 3 ayın medyanını tek
 * tık "Güncelle" ile önerir (min 2 örnek, sapma %10 VE 25 TL).
 */
import type { Budget, CardExpense } from '../types/database'
import { addMonths, isDateInMonth, startOfMonth } from './date'
import { roundTL, sumTL } from './money'

/** budgetAlerts ile aynı kova ve aynı `||` deseni (boş string gerçek boşluk). */
const UNCATEGORISED = 'Diğer'

/** budgetAlerts.activeExpense'in ikizi — oradan import etmek döngü kurardı
 *  (budgetAlerts çözümleme için bu modülü import ediyor). */
function isActive(expense: CardExpense) {
  return expense.status !== 'cancelled'
}

function categoryMonthTotal(expenses: CardExpense[], category: string, month: Date): number {
  return sumTL(
    expenses
      .filter((expense) => isActive(expense) && isDateInMonth(expense.spent_at, month))
      .filter((expense) => (expense.category || UNCATEGORISED) === category)
      .map((expense) => expense.amount),
  )
}

/** Verilen aydan önceki `monthsBack` TAM ayın kategori toplamları (yeniden eskiye). */
function trailingMonthTotals(expenses: CardExpense[], category: string, before: Date, monthsBack: number): number[] {
  return Array.from({ length: monthsBack }, (_, index) =>
    categoryMonthTotal(expenses, category, addMonths(startOfMonth(before), -(index + 1))),
  )
}

/** avg_spend çıpasının tabanı: önceki 3 tam ayın ortalaması (boş ay 0 sayılır). */
export function averageCategorySpend(expenses: CardExpense[], category: string, before: Date, monthsBack = 3): number {
  const totals = trailingMonthTotals(expenses, category, before, monthsBack)
  if (totals.length === 0) return 0
  return roundTL(sumTL(totals) / totals.length)
}

function monthDate(budget: Budget): Date {
  return new Date(`${budget.month}T00:00:00`)
}

/**
 * Bütçe satırlarının türetilmiş limitli kopyası. Manual satırlar referans
 * olarak aynen geçer. salary_pct maaşsız çözülemez → saklı 0 kalır (uydurma
 * sayı yazılmaz; rozet yine görünür, kullanıcı maaş kaydını fark eder).
 */
export function resolveBudgetRows(
  budgets: Budget[],
  expenses: CardExpense[],
  salary: number | null | undefined,
): Budget[] {
  return budgets.map((budget) => {
    if (budget.limit_anchor === 'avg_spend' && budget.limit_anchor_value) {
      const base = averageCategorySpend(expenses, budget.category, monthDate(budget))
      return { ...budget, limit_amount: roundTL(base * budget.limit_anchor_value) }
    }
    if (budget.limit_anchor === 'salary_pct' && budget.limit_anchor_value) {
      if (!salary || salary <= 0) return budget
      return { ...budget, limit_amount: roundTL((salary * budget.limit_anchor_value) / 100) }
    }
    return budget
  })
}

function formatFactor(value: number): string {
  return value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
}

/** Kart/rozet etiketi; manual satırda null (rozet gösterilmez). */
export function budgetAnchorLabel(budget: Pick<Budget, 'limit_anchor' | 'limit_anchor_value'>): string | null {
  if (!budget.limit_anchor_value) return null
  if (budget.limit_anchor === 'avg_spend') return `Son 3 ay ort. × ${formatFactor(budget.limit_anchor_value)}`
  if (budget.limit_anchor === 'salary_pct') return `Maaş %${formatFactor(budget.limit_anchor_value)}`
  return null
}

export type BudgetSuggestion = {
  budgetId: string
  category: string
  /** Son 3 tam ayın medyanı (yalnız harcaması olan aylar örnektir). */
  suggested: number
  current: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : roundTL((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Bayat manual bütçe önerisi. paymentEstimate ile aynı çizgi: medyan (tek aylık
 * sıçrama ortalamayı uçurmasın), en az 2 örnek, sapma eşiği %10 VE 25 TL (her
 * ay dırdır etmemek için). Limiti hiç girilmemiş (0) satırda öneri hep verilir.
 * Çıpalı satırlar atlanır — onlar zaten kendini güncelliyor.
 */
export function buildBudgetSuggestions(
  budgets: Budget[],
  expenses: CardExpense[],
  today: Date = new Date(),
): BudgetSuggestion[] {
  const suggestions: BudgetSuggestion[] = []
  for (const budget of budgets) {
    if (budget.limit_anchor !== 'manual') continue
    if (!isDateInMonth(budget.month, today)) continue

    const samples = trailingMonthTotals(expenses, budget.category, today, 3).filter((total) => total > 0)
    if (samples.length < 2) continue

    const suggested = roundTL(median(samples))
    const limit = budget.limit_amount
    const deviation = Math.abs(suggested - limit)
    const worthIt = limit > 0 ? deviation > limit * 0.1 && deviation > 25 : suggested > 0
    if (!worthIt) continue

    suggestions.push({ budgetId: budget.id, category: budget.category, suggested, current: limit })
  }
  return suggestions
}

/**
 * Ay devri şeridi: geçen ayda olup bu ayda karşılığı olmayan bütçe satırları.
 * Kopyalama tek tıkla ve KULLANICI eliyle yapılır — uygulama kendiliğinden
 * satır yaratmaz (kasa/tahmin güncellemeleriyle aynı çizgi).
 */
export function buildBudgetRollover(budgets: Budget[], today: Date = new Date()): Budget[] {
  const currentStart = startOfMonth(today)
  const previousStart = addMonths(currentStart, -1)
  const currentCategories = new Set(
    budgets.filter((budget) => isDateInMonth(budget.month, currentStart)).map((budget) => budget.category),
  )
  return budgets.filter(
    (budget) => isDateInMonth(budget.month, previousStart) && !currentCategories.has(budget.category),
  )
}
