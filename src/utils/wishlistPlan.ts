/**
 * İstek listesi maddesi için "ne zaman alabilirim + neyin payına denk" (saf).
 *
 * İstek listesi bugüne kadar düz bir CRUD listesiydi: yanında nakit
 * projeksiyonu (`cashFlowForecast`) ve hedef planı (`savingsSuggestion`) hazır
 * dururken madde satırı bunlardan habersizdi.
 *
 * İki cevap üretilir:
 *  1) **Ne zaman?** Projeksiyondaki ilk ay ki o ayın sonunda, güvenlik tamponunu
 *     ve kasa rezervini BOZMADAN fiyatı karşılayabiliyorsun. Bu ay zaten
 *     karşılanıyorsa "şimdi".
 *  2) **Neyin payına denk?** Tutar, aktif bir hedefe ayırdığın aylık payın kaç
 *     katı. Kasıtlı olarak "hedefini N ay geciktirir" DEMEZ: parayı o hedeften
 *     kısacağını bilemeyiz, yalnız büyüklüğü tanıdık bir birime çeviririz.
 *     (Bu ayrım denetimlerdeki "uygulama-içi tutarlılık ≠ doğruluk" dersiyle
 *     aynı çizgide: söylenmeyen varsayımı sayıya gömme.)
 */
import type { SavingsGoal } from '../types/database'
import type { CashFlowForecast } from './cashFlowForecast'
import { diffTL, greaterThanTL, roundTL } from './money'
import { buildSavingsSuggestion } from './savingsSuggestion'

export type WishlistPlanInput = {
  /** Maddenin tahmini fiyatı; girilmemişse null. */
  price: number | null
  forecast: CashFlowForecast
  /** Bugün harcanabilir (tampon + kasa rezervi düşülmüş). */
  safeToSpend: number
  /**
   * Ayın sonunda dokunulmaması gereken taban: güvenlik tamponu + kasa rezervi.
   * Projeksiyonun `endingBalance`'ı bunları içerdiği için çıkarılır.
   */
  floor: number
  /** Aktif hedefler (türetilmiş satırlar; bkz. goalSources.resolveSavingsGoalRows). */
  goals: SavingsGoal[]
}

export type WishlistPlan = {
  /** Bugünün harcanabiliriyle alınabiliyor mu? */
  affordableNow: boolean
  /** Alınabilecek ilk ay; ufuk içinde yoksa null ("bu ufukta çıkmıyor"). */
  month: { key: string; label: string } | null
  /** Tutarın karşılık geldiği aylık hedef payı sayısı (0 = kıyaslanacak hedef yok). */
  goalMonths: number
  /** Kıyaslamada kullanılan hedefin adı. */
  goalName: string | null
}

/**
 * Kıyas için en çok aylık pay isteyen aktif hedef: "asıl beslediğin" hedef.
 * Export: PurchaseDecisionPage'in emek çevirisi bloğu aynı hedefi kullanır —
 * iki yüzeyin "asıl beslenen" tanımı ayrışmasın.
 */
export function dominantSavingsGoal(goals: SavingsGoal[], today: Date): { goal: SavingsGoal; monthlyNeeded: number } | null {
  let best: { goal: SavingsGoal; monthlyNeeded: number } | null = null

  for (const goal of goals) {
    if (goal.status !== 'active' || goal.value_type !== 'TRY') continue
    const suggestion = buildSavingsSuggestion(goal, today)
    if (suggestion.pace !== 'active' || !suggestion.monthlyNeeded || suggestion.monthlyNeeded <= 0) continue
    if (!best || suggestion.monthlyNeeded > best.monthlyNeeded) {
      best = { goal, monthlyNeeded: suggestion.monthlyNeeded }
    }
  }

  return best
}

export function buildWishlistPlan(input: WishlistPlanInput, today: Date = new Date()): WishlistPlan | null {
  const { price } = input
  // Fiyatsız maddeye tarih vermek uydurma olurdu; satır sessiz kalır.
  if (price === null || !(price > 0)) return null

  const affordableNow = !greaterThanTL(price, input.safeToSpend)

  const month = affordableNow
    ? null
    : (() => {
        for (const forecastMonth of input.forecast.months) {
          if (!greaterThanTL(price, diffTL(forecastMonth.endingBalance, input.floor))) {
            return { key: forecastMonth.monthKey, label: forecastMonth.monthLabel }
          }
        }
        return null
      })()

  const dominant = dominantSavingsGoal(input.goals, today)
  // Yarım aydan küçük pay yuvarlanınca 0 olur ve cümle kurulmaz: "~1 aylık pay"
  // demek için tabanı 1'e çekmek küçük tutarları OLDUĞUNDAN BÜYÜK gösterirdi.
  const goalMonths = dominant ? Math.round(roundTL(price / dominant.monthlyNeeded)) : 0

  return {
    affordableNow,
    month,
    goalMonths,
    goalName: goalMonths > 0 ? (dominant?.goal.name ?? null) : null,
  }
}
