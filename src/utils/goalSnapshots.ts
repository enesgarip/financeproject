/**
 * Hedefin günlük değer fotoğrafına girecek satırları seçme (saf).
 *
 * Net değer fotoğrafının hedef bazlısı: günde bir kez, TÜRETİLMİŞ biriken
 * tutar (resolveSavingsGoalRows'tan geçmiş kopya satırlar) hedefin kendi
 * biriminde `savings_goal_snapshots`'a yazılır. Tarihçe olmadan "gerçekleşen
 * tempo" ve varış tahmini kurulamazdı — kasa kovası yalnız güncel rezervi,
 * net_worth_snapshots kırılımsız toplamı tutuyor.
 *
 * Girdi türetilmiş satır OLMALI: saklı `current_amount` kaynağa bağlı hedefte
 * 0'dır (20260824100000_savings_goal_sources.sql), ham satırı fotoğraflamak
 * seriyi sıfırlarla doldururdu.
 */
import type { SavingsGoal } from '../types/database'

export type GoalSnapshotEntry = {
  goalId: string
  /** Hedefin kendi biriminde: TRY→TL, gram/çeyrek→miktar, karma→ulaşan bileşen sayısı. */
  amount: number
}

/**
 * Fotoğraflanacak satırlar: aktif hedeflerin türetilmiş biriken tutarı.
 * Karma hedef de kaydedilir (birimi kaba olsa da veri kaybolmaz); tamamlanmış
 * hedefin serisini büyütmek ise gürültü olurdu — tempo bitmiş işi ölçmez.
 */
export function buildGoalSnapshotEntries(
  resolvedGoals: Array<Pick<SavingsGoal, 'id' | 'status' | 'current_amount'>>,
): GoalSnapshotEntry[] {
  return resolvedGoals
    .filter((goal) => goal.status === 'active')
    .filter((goal) => Number.isFinite(goal.current_amount) && goal.current_amount >= 0)
    .map((goal) => ({ goalId: goal.id, amount: goal.current_amount }))
}
