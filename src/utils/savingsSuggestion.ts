/**
 * Birikim hedefi için "aylık gerekli tutar" + nakit-akışına göre bu ay tavsiyesi (saf).
 *
 * İki ayrı hesap:
 *  - buildSavingsSuggestion(goal): hedefe, hedef tarihine kalan tam ay sayısına göre
 *    aylık ne kadar ayırmak gerektiğini verir. TRY hedefte tutar TL, altın hedefte
 *    birim (gram/çeyrek). Karma (composite) hedef bileşen SAYISI tuttuğu için aylık
 *    tutar anlamlı değil → pace 'unsupported'.
 *  - buildSavingsCashflowAdvice(totalNeeded, monthlySurplus): bu ayki harcanabilir
 *    (safeToSpend) ile toplam gerekliyi kıyaslar → "ayır / kısıtlı ayır / ara ver".
 *    Böylece backlog'daki "bu ay hedefe ara ver / fazladan ayırabilirsin" karşılanır.
 *
 * Para karşılaştırmaları money.ts ile; ay sayısı bir tahmindir (gün/30.44), tavsiye
 * için yeterli ve dürüst — kesin taksit planı değil.
 */
import type { SavingsGoal } from '../types/database'
import { startOfDay } from './date'
import { diffTL, exceedsTL, roundTL } from './money'

const DAYS_PER_MONTH = 30.44

export type SavingsPace = 'reached' | 'overdue' | 'no-date' | 'active' | 'unsupported'

export type SavingsSuggestion = {
  /** Kalan miktar (hedef − biriken), hedefin biriminde. */
  remaining: number
  /** Bugünden hedef tarihe kalan tam ay (>=1) veya tarih yoksa null. */
  monthsRemaining: number | null
  /** Aylık ayrılması gereken (kalan / kalan ay), hedefin biriminde; yoksa null. */
  monthlyNeeded: number | null
  pace: SavingsPace
}

export function buildSavingsSuggestion(
  goal: Pick<SavingsGoal, 'value_type' | 'target_amount' | 'current_amount' | 'target_date'>,
  today: Date = new Date(),
): SavingsSuggestion {
  // Karma hedefte target/current bileşen sayısıdır; aylık tutar üretilemez.
  if (goal.value_type === 'composite') {
    return { remaining: 0, monthsRemaining: null, monthlyNeeded: null, pace: 'unsupported' }
  }

  const remaining = Math.max(0, roundTL(diffTL(goal.target_amount, goal.current_amount)))

  if (!exceedsTL(goal.target_amount, goal.current_amount)) {
    return { remaining: 0, monthsRemaining: null, monthlyNeeded: 0, pace: 'reached' }
  }

  if (!goal.target_date) {
    return { remaining, monthsRemaining: null, monthlyNeeded: null, pace: 'no-date' }
  }

  const target = startOfDay(new Date(`${goal.target_date}T00:00:00`))
  const start = startOfDay(today)
  const days = (target.getTime() - start.getTime()) / 86_400_000

  if (days < 0) {
    // Hedef tarihi geçmiş ama birikim tamamlanmamış: kalanı tek seferde göster.
    return { remaining, monthsRemaining: 0, monthlyNeeded: remaining, pace: 'overdue' }
  }

  const monthsRemaining = Math.max(1, Math.ceil(days / DAYS_PER_MONTH))
  const monthlyNeeded = roundTL(remaining / monthsRemaining)

  return { remaining, monthsRemaining, monthlyNeeded, pace: 'active' }
}

export type SavingsCashflowAdvice = {
  tone: 'success' | 'warning' | 'danger'
  /** 'pause' = ara ver, 'partial' = kısmi ayır, 'full' = tamamını ayır (+fazla). */
  kind: 'pause' | 'partial' | 'full'
  /** Bu ay güvenle ayrılabilecek tutar (0..totalNeeded). */
  affordable: number
  /** Aktif TRY hedeflerinin toplam aylık gerekliği. */
  needed: number
  /** 'full' durumunda gerekliyi aşan fazla (>=0), diğerlerinde 0. */
  extra: number
}

/**
 * Bu ayki harcanabilir (safeToSpend) ile aktif TRY hedeflerinin toplam aylık
 * gerekliğini kıyaslar. Yalnız TRY hedefler için anlamlı (surplus TL cinsinden).
 * Tutarları biçimlemez — mesajı çağıran (formatAmount ile, bakiye gizlemeye saygılı)
 * kurar.
 */
export function buildSavingsCashflowAdvice(
  totalMonthlyNeeded: number,
  monthlySurplus: number,
): SavingsCashflowAdvice | null {
  if (totalMonthlyNeeded <= 0) return null

  const needed = roundTL(totalMonthlyNeeded)

  if (monthlySurplus <= 0) {
    return { tone: 'danger', kind: 'pause', affordable: 0, needed, extra: 0 }
  }

  if (!exceedsTL(totalMonthlyNeeded, monthlySurplus)) {
    // Harcanabilir >= gerekli: tamamını ayır, hatta fazlası var.
    return {
      tone: 'success',
      kind: 'full',
      affordable: needed,
      needed,
      extra: Math.max(0, roundTL(diffTL(monthlySurplus, totalMonthlyNeeded))),
    }
  }

  // 0 < harcanabilir < gerekli: kısmi ayır.
  return { tone: 'warning', kind: 'partial', affordable: roundTL(monthlySurplus), needed, extra: 0 }
}
