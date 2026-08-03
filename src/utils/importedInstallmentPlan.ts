import { addMonths, dateInputValue } from './date'
import { importAmountTolerance } from './importMatch'
import { diffTL, roundTL } from './money'

export type ImportedInstallmentPlan = {
  originalDate: string
  currentInstallmentDate: string
  installmentNo: number
  totalInstallments: number
  paidInstallments: number
  remainingInstallments: number
  totalAmount: number
  remainingAmount: number
}

export function buildImportedInstallmentPlan(input: {
  originalDate: string
  installmentNo: number
  totalInstallments: number
  installmentAmount: number
}): ImportedInstallmentPlan {
  const totalInstallments = Math.max(2, Math.trunc(input.totalInstallments))
  const installmentNo = Math.min(totalInstallments, Math.max(1, Math.trunc(input.installmentNo)))
  const paidInstallments = installmentNo - 1
  const remainingInstallments = totalInstallments - paidInstallments
  const originalDate = input.originalDate.slice(0, 10)
  const currentInstallmentDate = dateInputValue(
    addMonths(new Date(`${originalDate}T00:00:00`), paidInstallments),
  )

  return {
    originalDate,
    currentInstallmentDate,
    installmentNo,
    totalInstallments,
    paidInstallments,
    remainingInstallments,
    totalAmount: roundTL(input.installmentAmount * totalInstallments),
    remainingAmount: roundTL(input.installmentAmount * remainingInstallments),
  }
}

export type InstallmentNotationCheck = {
  /** Notasyon kendi içinde tutarlı mı (kalan ≈ aylık × kalan-adet). */
  consistent: boolean
  /** Aylık ve adetten beklenen kalan borç (bu taksit ödendikten sonrası). */
  expectedRemaining: number
  /** PDF'teki kalan − beklenen kalan (işaretli). */
  diffTL: number
}

/**
 * Ekstre taksit notasyonu (`<kalan>/<toplam>-<sıra>`) kendi içinde tutarlı mı?
 *
 * Kalan, BU taksit ödendikten SONRAKİ plan bakiyesidir → `kalan ≈ aylık ×
 * (toplam − sıra)`. Gerçek ekstrede bire bir tutar (ör. `43.333,33/3-1`:
 * 21.666,67 × 2 = 43.333,34). Tutmuyorsa ya toplam adet yanlış OKUNDU (fark bir
 * tam aylık tutar kadar büyük olur) ya da eşit-olmayan taksit var → `aylık ×
 * adet` ile toplamı körlemesine yeniden kurma; satırı manuel incelemeye düşür.
 *
 * Tolerans importAmountTolerance ile: kuruş yuvarlaması (birkaç kuruş) ve makul
 * eşit-olmayan sapma yutulur; yanlış adet (≥ bir aylık tutar) yakalanır.
 */
export function checkInstallmentNotation(input: {
  installmentAmount: number
  installmentNo: number
  totalInstallments: number
  remainingDebt: number
}): InstallmentNotationCheck {
  const remainingCount = Math.max(0, input.totalInstallments - input.installmentNo)
  const expectedRemaining = roundTL(input.installmentAmount * remainingCount)
  const diff = diffTL(input.remainingDebt, expectedRemaining)
  const tolerance = importAmountTolerance(expectedRemaining, input.remainingDebt)
  return { consistent: Math.abs(diff) <= tolerance, expectedRemaining, diffTL: diff }
}
