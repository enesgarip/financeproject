/**
 * FIRE (Financial Independence / Retire Early) hesaplayıcı — saf matematik.
 *
 * Verilen mevcut net değer, aylık gider, aylık birikim ve varsayımlardan
 * (reel getiri + güvenli çekim oranı) finansal bağımsızlığa ne zaman
 * ulaşılacağını ve yol boyunca net değer projeksiyonunu üretir. UI'dan bağımsız
 * kalsın diye yalnızca hesap yapar; tarih girdisi test edilebilirlik için
 * parametrelidir.
 */

export type FireInputs = {
  /** Şu anki yatırılabilir net değer (TRY). */
  currentNetWorth: number
  /** Ortalama aylık yaşam gideri (TRY). */
  monthlyExpenses: number
  /** Her ay eklenen birikim (TRY); negatif olabilir (açık). */
  monthlySavings: number
  /** Yıllık reel (enflasyondan arındırılmış) getiri yüzdesi, ör. 4. */
  annualRealReturnPct: number
  /** Güvenli yıllık çekim oranı yüzdesi, ör. 4 → 25× yıllık gider. */
  withdrawalRatePct: number
}

export type FireProjectionPoint = { month: number; netWorth: number }

export type FireResult = {
  /** Yıllık gider = monthlyExpenses × 12. */
  annualExpenses: number
  /** Hedef servet = yıllık gider / çekim oranı (ör. %4 → 25×). */
  fireNumber: number
  /** currentNetWorth / fireNumber × 100, 0–100 ile sınırlı. */
  progressPct: number
  /** Net değer zaten hedefe ulaşmış mı. */
  alreadyReached: boolean
  /** Hedefe kalan ay; ulaşılamıyorsa (birikim yetersiz) null. */
  monthsToFire: number | null
  /** monthsToFire / 12; null olabilir. */
  yearsToFire: number | null
  /** Tahmini ulaşma tarihi (YYYY-MM-DD); null olabilir. */
  targetDate: string | null
  /** Yıllık örneklenmiş net değer eğrisi (+ varsa kesin ulaşma noktası). */
  projection: FireProjectionPoint[]
}

const MAX_MONTHS = 1200 // 100 yıllık üst sınır — sonsuz döngüyü engeller
const FALLBACK_HORIZON = 360 // ulaşılamayınca grafiğin gösterileceği 30 yıllık ufuk

// Kasıtlı olarak money.ts DEĞİL: bunlar ledger'a girmeyen, on yıllar sonrasına
// dönük spekülatif projeksiyon/yüzde değerleri; yuvarlama yalnız grafik için
// kozmetik. roundTL'e bağlama (Faz C: para değil, display precision).
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function toIsoDate(date: Date): string {
  return date.toLocaleDateString('sv-SE') // YYYY-MM-DD, yerel
}

function addMonthsTo(from: Date, months: number): Date {
  const d = new Date(from)
  d.setMonth(d.getMonth() + months)
  return d
}

export function computeFire(inputs: FireInputs, from: Date = new Date()): FireResult {
  const monthlyExpenses = Math.max(0, inputs.monthlyExpenses)
  const annualExpenses = round(monthlyExpenses * 12)
  const wr = inputs.withdrawalRatePct / 100
  const fireNumber = wr > 0 ? round(annualExpenses / wr) : Number.POSITIVE_INFINITY
  const monthlyRate = Math.pow(1 + inputs.annualRealReturnPct / 100, 1 / 12) - 1

  const reachable = Number.isFinite(fireNumber) && fireNumber > 0
  const progressPct = reachable ? Math.max(0, Math.min(100, (inputs.currentNetWorth / fireNumber) * 100)) : 0
  const alreadyReached = reachable && inputs.currentNetWorth >= fireNumber

  // Hedefe kalan ayı simülasyonla bul.
  let monthsToFire: number | null = alreadyReached ? 0 : null
  if (reachable && !alreadyReached) {
    let nw = inputs.currentNetWorth
    for (let m = 1; m <= MAX_MONTHS; m++) {
      nw = nw * (1 + monthlyRate) + inputs.monthlySavings
      if (nw >= fireNumber) {
        monthsToFire = m
        break
      }
      // Büyümüyor ve çekim hedefin altındaysa asla ulaşılamaz; erken çık.
      if (inputs.monthlySavings <= 0 && monthlyRate <= 0) break
    }
  }

  // Projeksiyon: yıllık örnekleme + (varsa) kesin ulaşma noktası.
  const horizon = monthsToFire ?? Math.min(MAX_MONTHS, FALLBACK_HORIZON)
  const projection: FireProjectionPoint[] = [{ month: 0, netWorth: round(inputs.currentNetWorth) }]
  let nw = inputs.currentNetWorth
  for (let m = 1; m <= horizon; m++) {
    nw = nw * (1 + monthlyRate) + inputs.monthlySavings
    if (m % 12 === 0 || m === horizon) projection.push({ month: m, netWorth: round(nw) })
  }

  return {
    annualExpenses,
    fireNumber: reachable ? fireNumber : 0,
    progressPct: round(progressPct),
    alreadyReached,
    monthsToFire,
    yearsToFire: monthsToFire === null ? null : round(monthsToFire / 12),
    targetDate: monthsToFire === null ? null : toIsoDate(addMonthsTo(from, monthsToFire)),
    projection,
  }
}

/**
 * Net değer snapshot geçmişinden ortalama aylık birikim (KATKI) hızını tahmin et.
 * En az 2 snapshot ve ~1 aylık aralık gerekir; yoksa null döner.
 * Negatif (servet eriyor) sonucu olduğu gibi döndürür.
 *
 * Net değer artışı = katkı + yatırım getirisi. `annualRealReturnPct` verilirse,
 * bakiyenin dönem boyunca kazandığı getiri çıkarılır → sonuç saf aylık katkıdır.
 * computeFire aynı getiriyi zaten bileşik uyguladığından, bu çıkarma olmadan
 * getiri iki kez sayılır (çift sayım). Varsayılan 0 → ham net-değer artışı (geri uyumlu).
 */
export function estimateMonthlySavingsFromNetWorth(
  snapshots: Array<{ snapshot_date: string; net_worth: number }>,
  annualRealReturnPct = 0,
): number | null {
  if (snapshots.length < 2) return null
  const sorted = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const days = (new Date(last.snapshot_date).getTime() - new Date(first.snapshot_date).getTime()) / 86_400_000
  const months = days / 30.44
  if (months < 1) return null

  const monthlyRate = Math.pow(1 + annualRealReturnPct / 100, 1 / 12) - 1
  const estimatedReturns = ((first.net_worth + last.net_worth) / 2) * monthlyRate * months
  return round((last.net_worth - first.net_worth - estimatedReturns) / months)
}
