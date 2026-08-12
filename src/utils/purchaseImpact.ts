/**
 * "Bunu alsam ne olur?" — karar anı hesabı.
 *
 * Uygulama gerekli veriyi zaten biliyor (nakit projeksiyonu, taksit takvimi)
 * ama cevabı ancak sonradan, analiz ekranında veriyordu. Mağazada 10 saniyede
 * lazım olan şey bu: taksitli alırsam önümüzdeki aylar nasıl görünür.
 *
 * Model:
 *  - Kartla alım → nakit çıkışı harcamanın kendisinde değil, EKSTRE ödendiğinde
 *    olur. Bu yüzden ilk taksit bir sonraki aya (offset 1) düşer; N taksit
 *    N ay boyunca sürer.
 *  - Nakit/banka kartı → para hemen çıkar (offset 0).
 * Basitleştirme: taksitler ay başlarına değil, mevcut aylık projeksiyon
 * kovalarına eklenir; gün hassasiyeti karar için gereksiz.
 *
 * KARAR (denetim 2026-08-12): Model korunur, `safeToSpendAfter` modele
 * hizalanır. Tablo "kartla alımda bu ay 0 yük" derken aynı ekranda "sonra
 * harcanabilir" bu aydan taksit düşüyordu; aynı sayı iki farklı şey söylüyordu.
 * Artık `safeToSpendAfter` = `months[0]` ile aynı ayın harcanabiliri, yani
 * kartla alımda DEĞİŞMEZ. Yük görünmez olmasın diye taksit bu ayın
 * harcanabilirini aşıyorsa ayrı bir gerekçe satırı + 'dikkat' üretilir.
 * Saf; Supabase görmez.
 */
import type { CashFlowForecast } from './cashFlowForecast'
import { formatSeritAmount } from './formatCurrency'
import { diffTL, roundTL } from './money'

export type PurchasePaymentMethod = 'card' | 'cash'

export type PurchaseImpactInput = {
  amount: number
  /** 1 = peşin. Kartla alımda taksit sayısı. */
  installments: number
  method: PurchasePaymentMethod
  forecast: CashFlowForecast
  /** Bu ay harcanabilir tutar (safeToSpend). */
  safeToSpend: number
  /** Kullanıcının dokunulmaz tamponu; "dikkat" eşiği. */
  buffer: number
}

export type PurchaseImpactMonth = {
  label: string
  before: number
  after: number
  /** O aya düşen taksit tutarı. */
  charge: number
}

export type PurchaseVerdict = 'rahat' | 'dikkat' | 'zorlayici'

export type PurchaseImpactResult = {
  monthlyInstallment: number
  /** Son taksit; yuvarlama artığını emer (n × taksit her zaman = tutar). */
  lastInstallment: number
  months: PurchaseImpactMonth[]
  lowestAfter: number
  lowestLabel: string | null
  firstNegativeLabel: string | null
  safeToSpendAfter: number
  /** Projeksiyon penceresine sığmayan taksit sayısı (0 = hepsi görünüyor). */
  installmentsBeyondForecast: number
  verdict: PurchaseVerdict
  reasons: string[]
}

export function buildPurchaseImpact(input: PurchaseImpactInput): PurchaseImpactResult {
  const amount = Math.max(0, input.amount)
  const installments = Math.max(1, Math.trunc(input.installments || 1))
  const monthlyInstallment = roundTL(amount / installments)
  // Yuvarlama artığı son taksitte kapanır; yoksa n × taksit ≠ tutar olur ve
  // projeksiyondan kuruşlar sızar (12 taksitte fark kuruşları birikir).
  const lastInstallment = roundTL(diffTL(amount, roundTL(monthlyInstallment * (installments - 1))))

  // Kartla alımda ilk nakit çıkışı bir sonraki ekstrede; nakitte hemen.
  const startOffset = input.method === 'card' ? 1 : 0
  const lastChargeIndex = startOffset + installments - 1

  let running = 0
  const months: PurchaseImpactMonth[] = input.forecast.months.map((month, index) => {
    const inChargeWindow = index >= startOffset && index <= lastChargeIndex
    const charge = inChargeWindow ? (index === lastChargeIndex ? lastInstallment : monthlyInstallment) : 0
    running = roundTL(running + charge)
    return {
      label: month.monthLabel,
      before: month.endingBalance,
      after: roundTL(diffTL(month.endingBalance, running)),
      charge,
    }
  })

  // Ufuk taşması: 12 taksitli alımda 6 aylık pencere yalnız yarısını gösterir.
  // Görünmeyen taksitler karara sessizce girmesin diye açıkça sayılır.
  const firstHiddenChargeIndex = Math.max(startOffset, months.length)
  const installmentsBeyondForecast = Math.max(0, lastChargeIndex - firstHiddenChargeIndex + 1)

  let lowestAfter = Number.POSITIVE_INFINITY
  let lowestLabel: string | null = null
  let firstNegativeLabel: string | null = null
  for (const month of months) {
    if (month.after < lowestAfter) {
      lowestAfter = month.after
      lowestLabel = month.label
    }
    if (firstNegativeLabel === null && month.after < 0) firstNegativeLabel = month.label
  }
  if (!Number.isFinite(lowestAfter)) lowestAfter = 0

  // Kartla alımda bu ayın nakdi çıkmaz (ödeme ekstreyle gelir) → bu ayın
  // harcanabiliri değişmez; tablodaki "bu ay 0 yük" ile aynı şeyi söyler.
  const safeToSpendAfter = input.method === 'cash'
    ? roundTL(diffTL(input.safeToSpend, amount))
    : roundTL(input.safeToSpend)

  const reasons: string[] = []
  let verdict: PurchaseVerdict = 'rahat'

  if (firstNegativeLabel) {
    verdict = 'zorlayici'
    reasons.push(`${firstNegativeLabel} ayında bakiye eksiye düşüyor.`)
  } else if (lowestLabel !== null && lowestAfter < input.buffer) {
    verdict = 'dikkat'
    reasons.push(`En düşük nokta (${lowestLabel}) güvenlik tamponunun altına iniyor.`)
  }

  if (safeToSpendAfter < 0) {
    if (verdict === 'rahat') verdict = 'dikkat'
    reasons.push('Bu ayın harcanabilir tutarını aşıyor.')
  } else if (input.method === 'card' && monthlyInstallment > input.safeToSpend) {
    // Bu ayın nakdi etkilenmez ama taksit bu ayın harcanabilirinden büyükse
    // ödeme geldiğinde zorlanma sinyali verilmeli.
    if (verdict === 'rahat') verdict = 'dikkat'
    reasons.push(
      `Aylık ${formatSeritAmount(monthlyInstallment, { decimals: 2 })} taksit, bu ayın harcanabilir tutarından yüksek; ilk ödeme bir sonraki ekstrede.`,
    )
  }

  if (installments > 1) {
    reasons.push(`${installments} ay boyunca aylık ${formatSeritAmount(monthlyInstallment, { decimals: 2 })} yük ekler.`)
  }

  if (installmentsBeyondForecast > 0) {
    reasons.push(
      `${installmentsBeyondForecast} taksit (${formatSeritAmount(
        roundTL(installmentsBeyondForecast * monthlyInstallment),
        { decimals: 2 },
      )}) nakit projeksiyonu penceresinin dışında kalıyor; tablodaki aylar bu yükü göstermez.`,
    )
  }

  if (months.length === 0) {
    reasons.push('Nakit projeksiyonu oluşturulamadı; karar yalnız bu ayın harcanabilir tutarına dayanıyor.')
  }

  if (verdict === 'rahat' && reasons.length === 0) {
    reasons.push('Projeksiyon boyunca bakiye tamponun üstünde kalıyor.')
  }

  return {
    monthlyInstallment,
    lastInstallment,
    months,
    lowestAfter,
    lowestLabel,
    firstNegativeLabel,
    safeToSpendAfter,
    installmentsBeyondForecast,
    verdict,
    reasons,
  }
}
