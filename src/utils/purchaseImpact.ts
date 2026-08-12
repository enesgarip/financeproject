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
  months: PurchaseImpactMonth[]
  lowestAfter: number
  lowestLabel: string | null
  firstNegativeLabel: string | null
  safeToSpendAfter: number
  verdict: PurchaseVerdict
  reasons: string[]
}

export function buildPurchaseImpact(input: PurchaseImpactInput): PurchaseImpactResult {
  const amount = Math.max(0, input.amount)
  const installments = Math.max(1, Math.trunc(input.installments || 1))
  const monthlyInstallment = roundTL(amount / installments)

  // Kartla alımda ilk nakit çıkışı bir sonraki ekstrede; nakitte hemen.
  const startOffset = input.method === 'card' ? 1 : 0

  let running = 0
  const months: PurchaseImpactMonth[] = input.forecast.months.map((month, index) => {
    const inChargeWindow = index >= startOffset && index < startOffset + installments
    const charge = inChargeWindow ? (input.method === 'cash' && installments === 1 ? amount : monthlyInstallment) : 0
    running = roundTL(running + charge)
    return {
      label: month.monthLabel,
      before: month.endingBalance,
      after: roundTL(diffTL(month.endingBalance, running)),
      charge,
    }
  })

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

  const safeToSpendAfter = roundTL(diffTL(input.safeToSpend, input.method === 'cash' ? amount : monthlyInstallment))

  const reasons: string[] = []
  let verdict: PurchaseVerdict = 'rahat'

  if (firstNegativeLabel) {
    verdict = 'zorlayici'
    reasons.push(`${firstNegativeLabel} ayında bakiye eksiye düşüyor.`)
  } else if (lowestAfter < input.buffer) {
    verdict = 'dikkat'
    reasons.push(`En düşük nokta (${lowestLabel}) güvenlik tamponunun altına iniyor.`)
  }

  if (safeToSpendAfter < 0) {
    if (verdict === 'rahat') verdict = 'dikkat'
    reasons.push('Bu ayın harcanabilir tutarını aşıyor.')
  }

  if (installments > 1) {
    reasons.push(`${installments} ay boyunca aylık ${formatSeritAmount(monthlyInstallment, { decimals: 2 })} yük ekler.`)
  }

  if (verdict === 'rahat' && reasons.length === 0) {
    reasons.push('Projeksiyon boyunca bakiye tamponun üstünde kalıyor.')
  }

  return {
    monthlyInstallment,
    months,
    lowestAfter,
    lowestLabel,
    firstNegativeLabel,
    safeToSpendAfter,
    verdict,
    reasons,
  }
}
