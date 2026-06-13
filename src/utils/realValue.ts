/**
 * Pure conversion utilities for displaying net worth in alternative units.
 * All functions are side-effect-free and unit-testable in isolation.
 */

export type RealUnit = 'TRY' | 'GRA' | 'USD'

export const REAL_UNIT_LABELS: Record<RealUnit, string> = {
  TRY: 'TL',
  GRA: 'Gram altın',
  USD: 'USD',
}

export type RealRates = {
  goldTry?: number | null
  usdTry?: number | null
}

/** Convert a TRY amount into gold grams. Returns null when rate is missing or invalid. */
export function tryToGoldGrams(tryAmount: number, goldTryRate: number | null | undefined): number | null {
  if (!Number.isFinite(tryAmount)) return null
  if (!goldTryRate || !Number.isFinite(goldTryRate) || goldTryRate <= 0) return null
  // Sonuç gram (TL değil) — money.ts'e bağlama; bu birim dönüşümü/display precision (Faz C).
  return Math.round((tryAmount / goldTryRate) * 100) / 100
}

/** Convert a TRY amount into USD. Returns null when rate is missing or invalid. */
export function tryToUsd(tryAmount: number, usdTryRate: number | null | undefined): number | null {
  if (!Number.isFinite(tryAmount)) return null
  if (!usdTryRate || !Number.isFinite(usdTryRate) || usdTryRate <= 0) return null
  // Sonuç USD (TL değil) — money.ts'e bağlama; birim dönüşümü/display precision (Faz C).
  return Math.round((tryAmount / usdTryRate) * 100) / 100
}

/**
 * Convert a TRY net-worth value into the requested unit.
 * Returns null when the required rate is unavailable.
 */
export function convertNetWorth(tryAmount: number, unit: RealUnit, rates: RealRates): number | null {
  if (unit === 'TRY') return tryAmount
  if (unit === 'GRA') return tryToGoldGrams(tryAmount, rates.goldTry)
  if (unit === 'USD') return tryToUsd(tryAmount, rates.usdTry)
  return null
}

/**
 * Format a real-value amount with its unit symbol.
 * TRY formatting is intentionally left to the caller (formatCurrency).
 */
export function formatRealValue(amount: number, unit: RealUnit): string {
  if (unit === 'GRA') {
    return `${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gr`
  }
  if (unit === 'USD') {
    const abs = Math.abs(amount)
    const formatted = abs.toLocaleString('tr-TR', { maximumFractionDigits: 0 })
    return amount < 0 ? `-$${formatted}` : `$${formatted}`
  }
  // TRY — caller should use formatCurrency; fallback for safety
  return amount.toLocaleString('tr-TR', { maximumFractionDigits: 0 })
}

/**
 * Build a change badge label (+X gr / +$X / +₺X).
 * Returns null when conversion is not possible.
 */
export function realValueChangeBadge(
  tryChange: number,
  unit: RealUnit,
  rates: RealRates,
): string | null {
  if (unit === 'TRY') return null // handled by caller using formatCurrency
  const converted = convertNetWorth(tryChange, unit, rates)
  if (converted === null) return null
  const prefix = converted >= 0 ? '+' : ''
  return `${prefix}${formatRealValue(converted, unit)}`
}
