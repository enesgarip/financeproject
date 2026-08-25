/**
 * Bütçe→hedef köprüsü (saf): ayın son günlerinde bütçelerden artan tutarı
 * hedef kovasına ayırmayı önerir — "altında kaldım" bilgisi karar anında
 * aksiyona dönüşür (ayır → harcanabilir düşer → hedef ilerler).
 *
 * Üç dürüstlük kuralı:
 *  - Yalnız ayın SON 3 gününde konuşur; ay ortasında "kalan bütçe" artık değil,
 *    henüz harcanmamış plandır.
 *  - Küçük artık (100 TL altı) dürtmeye değmez.
 *  - Hedef seçimi wishlistPlan'daki "asıl beslenen hedef" mantığı: kovası olan
 *    aktif hedeflerden aylık payı en çok isteyen. İkinci bir yazma yolu
 *    açılmaz — ayırma mevcut contribute_to_goal_bucket RPC'siyle yapılır.
 *
 * Ayırdıktan (ya da kapattıktan) sonra aynı ay tekrar önermemek çağıranın
 * işidir (localStorage ay damgası) — kova ay damgası kullanılamaz, normal
 * aylık ayırma da onu basar ve köprünün asıl değeri PLAN ÜSTÜ artığı yakalamak.
 */
import type { KasaBucket, SavingsGoal } from '../types/database'
import type { BudgetUsage } from './budgetAlerts'
import { endOfMonth } from './date'
import { bucketForGoal } from './goalBucket'
import { roundTL, sumTL } from './money'
import { buildSavingsSuggestion } from './savingsSuggestion'

const BRIDGE_WINDOW_DAYS = 3
const BRIDGE_MIN_SURPLUS = 100

export type BudgetSurplusBridge = {
  /** Bu ay bütçelerde kalan toplam (yalnız limitli satırların pozitif kalanı). */
  surplus: number
  goalId: string
  goalName: string
  bucketId: string
  bucketName: string
}

export function buildBudgetSurplusBridge(
  usage: BudgetUsage[],
  goals: SavingsGoal[],
  buckets: KasaBucket[],
  today: Date = new Date(),
): BudgetSurplusBridge | null {
  const daysLeft = endOfMonth(today).getDate() - today.getDate()
  if (daysLeft >= BRIDGE_WINDOW_DAYS) return null

  const surplus = roundTL(sumTL(usage.filter((item) => item.limit > 0).map((item) => item.remaining)))
  if (surplus < BRIDGE_MIN_SURPLUS) return null

  // Aylık payı en çok isteyen, kovası olan aktif hedef (wishlistPlan mantığı).
  const target = goals
    .filter((goal) => goal.status === 'active')
    .map((goal) => ({
      goal,
      bucket: bucketForGoal(goal.id, buckets),
      monthlyNeeded: buildSavingsSuggestion(goal).monthlyNeeded ?? 0,
    }))
    .filter((row): row is typeof row & { bucket: KasaBucket } => row.bucket !== null)
    .sort((a, b) => b.monthlyNeeded - a.monthlyNeeded)[0]
  if (!target) return null

  return {
    surplus,
    goalId: target.goal.id,
    goalName: target.goal.name,
    bucketId: target.bucket.id,
    bucketName: target.bucket.name,
  }
}
