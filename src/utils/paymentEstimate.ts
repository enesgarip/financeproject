/**
 * "Yaklaşık" planlı ödeme tutarını gerçekleşen ödemelerden tazeleme (saf).
 *
 * `payments.amount_status = 'estimated'` olan satırlar (elektrik, su, doğalgaz…)
 * ekranda "Yaklaşık ₺450" diye görünür — ama o sayı kullanıcının bir kez yazdığı
 * sayıdır ve kimse güncellemez. Oysa `transaction_history` gerçekte ne ödendiğini
 * biliyor. Tahmin bayatladıkça nakit projeksiyonu ve "bu ay harcayabilirim"
 * SİSTEMATİK olarak iyimser çıkar — hata tek yönlüdür, çünkü faturalar zamanla
 * artar.
 *
 * Karar dili kasıtlı: uygulama tutarı KENDİLİĞİNDEN değiştirmez, önerir. Planlı
 * ödeme tutarı kullanıcının taahhüdüdür; sessizce oynatmak "benim yazdığım sayı
 * nerede?" sorusunu doğururdu (aynı çizgi: kasa kovasına otomatik ayırma da
 * tek tık bırakıldı).
 *
 * Geçmiş sözleşmesi `paymentHistory.ts`'te: ödeme satırı
 * (type='payment', source_table='payments', source_id=<ödeme>) ve onu tersleyen
 * "geri alındı" satırı serbest metinden tanınır.
 */
import type { Payment, TransactionHistory } from '../types/database'
import { isPaymentUndoRow } from './paymentHistory'
import { diffTL, roundTL } from './money'
import { median } from './spendingStats'

export type PaymentEstimateSuggestion = {
  /** Önerilen tutar: son ödemelerin medyanı. */
  suggested: number
  /** Medyanın hesaplandığı gerçek ödeme sayısı. */
  sampleCount: number
  /** En son gerçekleşen ödeme tutarı (cümlede "son ödemen" olarak geçer). */
  latest: number
}

/** Medyanın kaç ödemeye bakacağı: tek aylık sıçrama tahmini uçurmasın. */
const SAMPLE_SIZE = 3
/** Bu kadar örnek yoksa öneri yapılmaz — iki nokta bir eğilim değildir. */
const MIN_SAMPLE = 2
/** Bu orandan küçük sapma "bayat" sayılmaz; her ay dırdır etmemek için. */
const MIN_CHANGE_RATIO = 0.1
/** Küçük faturalarda oran tek başına yeterli değil: mutlak eşik de aranır. */
const MIN_CHANGE_AMOUNT = 25

/**
 * Bir ödemenin gerçekleşen tutarları, eskiden yeniye.
 *
 * "Geri alındı" satırı KENDİNDEN ÖNCEKİ ödemeyi siler; aksi hâlde iptal edilmiş
 * bir tutar ortalamayı kalıcı olarak bozardı.
 */
export function realizedPaymentAmounts(paymentId: string, history: TransactionHistory[]): number[] {
  const amounts: number[] = []

  for (const row of [...history].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (row.type !== 'payment' || row.source_table !== 'payments' || row.source_id !== paymentId) continue

    if (isPaymentUndoRow(row)) {
      amounts.pop()
      continue
    }

    const amount = Number(row.amount ?? 0)
    if (amount > 0) amounts.push(roundTL(amount))
  }

  return amounts
}

/**
 * Tahmini tutarı tazeleme önerisi; öneri yoksa null.
 *
 * Yalnız `estimated` satırlar için: `exact` tutar kullanıcının bildiği kesin
 * rakamdır (kira gibi), oraya "şunu yaz" demek yanlış olur.
 */
export function buildPaymentEstimateSuggestion(
  payment: Pick<Payment, 'id' | 'amount' | 'amount_status'>,
  history: TransactionHistory[],
): PaymentEstimateSuggestion | null {
  if (payment.amount_status !== 'estimated') return null

  const amounts = realizedPaymentAmounts(payment.id, history)
  if (amounts.length < MIN_SAMPLE) return null

  const sample = amounts.slice(-SAMPLE_SIZE)
  const suggested = roundTL(median(sample))
  if (!(suggested > 0)) return null

  const difference = Math.abs(diffTL(suggested, payment.amount))
  if (difference < MIN_CHANGE_AMOUNT) return null
  // Tutar hiç girilmemişse (0 = "tutar bekleniyor") oran hesaplanamaz ama öneri
  // en değerli olduğu yer tam da burasıdır.
  if (payment.amount > 0 && difference / payment.amount < MIN_CHANGE_RATIO) return null

  return { suggested, sampleCount: sample.length, latest: sample[sample.length - 1]! }
}
