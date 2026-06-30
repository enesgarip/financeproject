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
