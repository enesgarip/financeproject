/**
 * "Bu ay rahatça ne kadar harcayabilirim?" — uygulamanın tek sayısı.
 *
 * Dashboard 8 rakamı yan yana gösteriyordu; hiçbiri doğrudan izin vermiyordu.
 * Bu hesap onları tek karara indirir:
 *
 *   harcanabilir = likit nakit + kalan gelir − kalan yükümlülük − güvenlik tamponu
 *
 * Tanımlar bilinçli:
 *  - Likit = banka bakiyeleri + nakit varlıklar. Araç/BES/hisse SAYILMAZ;
 *    bu ay harcanamayacak parayı "harcanabilir" göstermek yanıltıcı olur.
 *  - Kalan yükümlülük = bugünden ay sonuna kalan nakit çıkışı
 *    (financeSummary.remainingOutflow) — geçmiş vadeleri tekrar saymaz.
 *  - Tampon kullanıcı tercihidir; sıfır tampon "her kuruşu harcayabilirsin"
 *    demek olur ki beklenmedik gider ihtimalinde yanlış tavsiyedir.
 * Saf; Supabase görmez.
 */
import { diffTL, roundTL, sumTL } from './money'

export type SafeToSpendInput = {
  /** Banka bakiyeleri + nakit varlıklar (financeSummary.totalCashAssets). */
  liquidCash: number
  /** Bu ay henüz girmemiş gelir (maaş yatmadıysa). */
  expectedIncome: number
  /** Bugünden ay sonuna kalan nakit çıkışı. */
  remainingOutflow: number
  /** Kullanıcının dokunulmaz tamponu. */
  buffer: number
  /** Kasa modu kovalarında ayrılan toplam (varsa); tampon gibi düşülür. */
  reserved?: number
}

export type SafeToSpendResult = {
  amount: number
  isNegative: boolean
  /**
   * Negatifliğin sebebi. 'obligations' = planlanan çıkış eldeki parayı aşıyor
   * (gerçek uyarı). 'buffer' = yükümlülük yok ama tampon eldekinden büyük
   * (uyarı DEĞİL; boş/yeni hesapta sahte alarm vermemek için ayrıştırılır).
   */
  negativeCause: 'obligations' | 'buffer' | null
  /** Tampon düşülmeden önceki tutar; "tamponu yersen bu kadar" açıklaması için. */
  beforeBuffer: number
  /** Kalan yükümlülüğün likit+gelire oranı (%), 0-100+; baskı göstergesi. */
  pressurePct: number
}

export const DEFAULT_BUFFER = 5000

export function buildSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const available = sumTL([Math.max(0, input.liquidCash), Math.max(0, input.expectedIncome)])
  const outflow = Math.max(0, input.remainingOutflow)
  const beforeBuffer = diffTL(available, outflow)
  // Tampon + kasa rezervi birlikte düşülür; ikisi de "dokunulmaz ayrılmış" para.
  const reserves = sumTL([Math.max(0, input.buffer), Math.max(0, input.reserved ?? 0)])
  // Yuvarlamayı bir kez yap: isNegative/negativeCause ile gösterilen `amount`
  // aynı değere baksın. Aksi halde -0.004 gibi bir uçta ekran "0 TL" gösterip
  // isNegative=true verir (sahte kırmızı).
  const amount = roundTL(diffTL(beforeBuffer, reserves))

  return {
    amount,
    isNegative: amount < 0,
    negativeCause: amount >= 0 ? null : beforeBuffer < 0 ? 'obligations' : 'buffer',
    beforeBuffer: roundTL(beforeBuffer),
    pressurePct: available > 0 ? Math.round((outflow / available) * 100) : outflow > 0 ? 100 : 0,
  }
}
