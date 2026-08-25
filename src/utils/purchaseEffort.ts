/**
 * "Bu tutar neye denk?" — karar ekranı kıyas bloğu (saf).
 *
 * Projeksiyon tablosu "karşılayabilir misin"e cevap verir; bu blok "değer mi"
 * sorusuna. TL soyut, emek ve hedef payı somuttur: tutar (1) kaç iş günü
 * çalışmaya, (2) kaç günlük ortalama nakit çıkışına, (3) asıl beslenen hedefin
 * kaç aylık payına çevrilir.
 *
 * Dil disiplini wishlistPlan ile AYNI: hedef için "geciktirir" DEMEyiz (paranın
 * o hedeften kısılacağı varsayımı sayıya gömülmez), yalnız tanıdık birime
 * çeviririz. Girdisi eksik satır 0 basmaz, SUSAR (uydurma kıyas yok).
 */
import type { SavingsGoal } from '../types/database'
import { roundTL } from './money'

/** Aylık brüt iş günü varsayımı (hafta içi ~21 gün). */
export const WORK_DAYS_PER_MONTH = 21
/** Ay uzunluğu — goalEta ile aynı sabit (365,25/12). */
export const DAYS_PER_MONTH = 30.44

export type PurchaseEffort = {
  /** Tutarın kaç iş günlük maaşa denk geldiği; maaş kaydı yoksa null (satır susar). */
  workDays: number | null
  /** Kaç günlük ortalama nakit çıkışına denk; ortalama 0/bilinmiyorsa null. */
  outflowDays: number | null
  /** Baskın hedefin kaç aylık payı (0 = kıyaslanacak hedef yok, cümle kurulmaz). */
  goalMonths: number
  goalName: string | null
}

// Gün sayıları ORAN'dır (para değil) — tek hane okunaklılık için yeter;
// money.ts karşılaştırmalarına bağlanmaz (bilinçli para-dışı yuvarlama).
function roundDays(value: number) {
  return Math.round(value * 10) / 10
}

export function buildPurchaseEffort(input: {
  amount: number
  /** Güncel net maaş (getCurrentSalary); kayıt yoksa null. */
  salary: number | null
  /** Gerçekleşen aylık ortalama nakit çıkışı (averageMonthlyOutflow); veri yoksa 0. */
  monthlyOutflow: number
  /** wishlistPlan.dominantSavingsGoal çıktısı: asıl beslenen hedef + aylık payı. */
  dominant: { goal: SavingsGoal; monthlyNeeded: number } | null
}): PurchaseEffort | null {
  if (!(input.amount > 0)) return null

  const workDays =
    input.salary !== null && input.salary > 0 ? roundDays(input.amount / (input.salary / WORK_DAYS_PER_MONTH)) : null
  const outflowDays =
    input.monthlyOutflow > 0 ? roundDays(input.amount / (input.monthlyOutflow / DAYS_PER_MONTH)) : null
  // wishlistPlan ile aynı yuvarlama disiplini: yarım aydan küçük pay 0'a düşer
  // ve cümle kurulmaz — küçük tutarı olduğundan büyük göstermeyiz.
  const goalMonths = input.dominant ? Math.round(roundTL(input.amount / input.dominant.monthlyNeeded)) : 0

  return {
    workDays,
    outflowDays,
    goalMonths,
    goalName: goalMonths > 0 && input.dominant ? input.dominant.goal.name : null,
  }
}
