/**
 * Vazgeçme Kazancı önizlemesi (saf): "bu tutarı hedefe ayırırsan varış ~X → ~Y".
 *
 * Dürtü zaferini görünmez bir "hiçlik"ten ölçülebilir kazanca çevirir: para
 * gerçekten kovaya gider (contribute_to_goal_bucket), hedef tarihi gerçekten
 * öne gelir. goalEta'nın dürüstlük kuralları AYNEN geçerli: tempo gate'i
 * (45 gün + 2 ay) geçilmemişse ya da eta çıkmıyorsa TARİH UYDURULMAZ —
 * çağıran tarihsiz dile düşer ("hedefe ₺X eklenir").
 *
 * wishlistPlan'ın "geciktirir demeyiz" disiplininden FARKI bilinçli: burada
 * varsayım değil, kullanıcının açıkça seçtiği gerçek bir yazma konuşur.
 */
import type { SavingsGoal } from '../types/database'
import { buildGoalEta, type GoalTempo } from './goalEta'
import { diffTL } from './money'

export type ForegoneGainPreview =
  | { kind: 'dated'; beforeLabel: string; afterLabel: string; monthsSaved: number }
  /** Ayrılan tutar hedefin kalanını karşılıyor — hedef tamamlanır. */
  | { kind: 'completes' }
  /** Tempo verisi yetersiz ya da eta yok — tarih verilmez, yalnız tutar dili. */
  | { kind: 'undated' }

export function buildForegoneGainPreview(input: {
  goal: Pick<SavingsGoal, 'target_date'>
  /** Hedefin kalanı (çözülmüş satırdan, hedefin kendi birimi = TRY hedefte TL). */
  remaining: number
  amount: number
  tempo: GoalTempo | null
  today?: Date
}): ForegoneGainPreview {
  const today = input.today ?? new Date()
  if (diffTL(input.remaining, input.amount) <= 0) return { kind: 'completes' }

  const before = buildGoalEta(input.goal, input.remaining, input.tempo, today)
  const after = buildGoalEta(input.goal, diffTL(input.remaining, input.amount), input.tempo, today)
  if (!before || !after) return { kind: 'undated' }

  return {
    kind: 'dated',
    beforeLabel: before.etaLabel,
    afterLabel: after.etaLabel,
    monthsSaved: Math.max(0, before.months - after.months),
  }
}
