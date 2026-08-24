/**
 * Hedefe bağlı kasa kovasının aylık ayırma planı (saf).
 *
 * "Aylık gerekli" hesabı `savingsSuggestion.ts`'te; burada yalnız o sayının bu
 * ay kovaya girip girmediği ve kullanıcıya ne söyleneceği belirlenir.
 *
 * Ayırma otomatik değil: kova harcanabilir tutarı gerçekten düşürdüğü için
 * (kasaMode + safeToSpend) kullanıcı fark etmeden hareket etmemeli. Bu modül
 * "bu ay bekliyor" ile "bu ay ayrıldı"yı ayırır, karar kullanıcıda kalır.
 */
import type { KasaBucket, SavingsGoal, SavingsGoalSource } from '../types/database'
import { startOfMonth, dateInputValue } from './date'
import { roundTL } from './money'
import { buildSavingsSuggestion } from './savingsSuggestion'

export type GoalBucketPlan = {
  bucket: KasaBucket
  /** Kovada şu an ayrılmış toplam. */
  reserved: number
  /** Bu ay ayrılması önerilen tutar; 0 = plan yok (tarihsiz ya da tamamlanmış hedef). */
  monthlyNeeded: number
  /** Bu ay ayırma yapıldı mı? */
  contributedThisMonth: boolean
  /**
   * Kova aynı zamanda hedefin takip KAYNAĞI mı?
   *
   * Değilse ayrılan nakit hedefin ilerlemesine yansımaz — ör. ilerlemesi hisse
   * portföyünden gelen bir hedefe kova ayırmak "hisse almak için para biriktir"
   * demektir, ilerleme ancak hisse alınca artar. Arayüz bunu söylemek zorunda;
   * yoksa kullanıcı "ayırdım ama yüzde artmadı" diye haklı olarak şaşırır.
   */
  fundsProgress: boolean
}

export function isSameMonth(value: string | null | undefined, today: Date): boolean {
  if (!value) return false
  return value.slice(0, 7) === dateInputValue(startOfMonth(today)).slice(0, 7)
}

export function buildGoalBucketPlan(
  goal: SavingsGoal,
  bucket: KasaBucket | null | undefined,
  sources: SavingsGoalSource[] = [],
  today: Date = new Date(),
): GoalBucketPlan | null {
  if (!bucket) return null

  const suggestion = buildSavingsSuggestion(goal, today)
  const monthlyNeeded =
    goal.status === 'active' && suggestion.pace === 'active' && suggestion.monthlyNeeded != null
      ? roundTL(suggestion.monthlyNeeded)
      : 0

  return {
    bucket,
    reserved: bucket.reserved_amount,
    monthlyNeeded,
    contributedThisMonth: isSameMonth(bucket.last_contribution_month, today),
    fundsProgress: sources.some(
      (source) => source.goal_id === goal.id && source.kind === 'kasa_bucket' && source.bucket_id === bucket.id,
    ),
  }
}

/** Hedefe bağlı kovayı bulur (en fazla bir tane olabilir). */
export function bucketForGoal(goalId: string, buckets: KasaBucket[]): KasaBucket | null {
  return buckets.find((bucket) => bucket.goal_id === goalId) ?? null
}
