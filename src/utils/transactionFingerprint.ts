/**
 * İçe aktarmada DUPLICATE (mükerrer) işlem tespiti için parmak izi üretir.
 *
 * Parmak izi = hesap + tarih + kuruş tutar + normalize açıklama + tür. Aynı
 * parmak izli iki satır büyük olasılıkla aynı harcamadır → tekrar eklenmez.
 * `descriptionSimilarity` ise iki açıklamanın token örtüşmesini (Jaccard, 0-1)
 * verir; parmak izi birebir tutmadığında "yakın mı?" kararına yardım eder.
 * Tutar kuruşa çevrilir (toKurus) ki float farkı sahte ayrım yaratmasın.
 */
import { toKurus } from './money'
import { normalizeSearchText } from './searchText'

export type TransactionFingerprintInput = {
  accountId: string
  date: string
  amount: number
  description: string | null | undefined
  type: string
}

export function normalizedTransactionDescription(value: string | null | undefined): string {
  return normalizeSearchText(value ?? '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function buildTransactionFingerprint(input: TransactionFingerprintInput): string {
  return [
    input.accountId,
    input.date.slice(0, 10),
    toKurus(input.amount),
    normalizedTransactionDescription(input.description),
    normalizeSearchText(input.type),
  ].join('|')
}

export function descriptionSimilarity(left: string | null | undefined, right: string | null | undefined): number {
  const leftTokens = new Set(normalizedTransactionDescription(left).split(' ').filter((token) => token.length >= 2))
  const rightTokens = new Set(normalizedTransactionDescription(right).split(' ').filter((token) => token.length >= 2))

  if (leftTokens.size === 0 && rightTokens.size === 0) return 1
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union === 0 ? 0 : intersection / union
}

function installmentSequenceMarker(value: string | null | undefined) {
  return normalizedTransactionDescription(value).match(/\b(\d+)\s+tk\b/)?.[1] ?? null
}

function chargeComponentMarker(value: string | null | undefined) {
  return normalizedTransactionDescription(value).match(/\b(anapara|faiz|bsmv|kkdf)\b/)?.[1] ?? null
}

/**
 * Banka açıklaması iki satırın aynı ana işleme ait ama farklı finansal parçalar
 * olduğunu açıkça kanıtlıyor mu? Farklı taksit numarası veya farklı
 * anapara/faiz/vergi bileşeni, aynı gün+tutar olsa bile duplicate değildir.
 */
export function descriptionsProveDistinct(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const leftInstallment = installmentSequenceMarker(left)
  const rightInstallment = installmentSequenceMarker(right)
  if (leftInstallment && rightInstallment && leftInstallment !== rightInstallment) return true

  const leftComponent = chargeComponentMarker(left)
  const rightComponent = chargeComponentMarker(right)
  return Boolean(leftComponent && rightComponent && leftComponent !== rightComponent)
}
