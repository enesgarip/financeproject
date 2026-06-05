import { describe, expect, it } from 'vitest'
import {
  convertNetWorth,
  formatRealValue,
  realValueChangeBadge,
  tryToGoldGrams,
  tryToUsd,
} from './realValue'

describe('tryToGoldGrams', () => {
  it('divides TRY by gold rate and rounds to 2 decimals', () => {
    expect(tryToGoldGrams(100_000, 4000)).toBe(25)
    expect(tryToGoldGrams(10_000, 3000)).toBe(3.33)
  })

  it('returns null for invalid rate', () => {
    expect(tryToGoldGrams(100_000, 0)).toBeNull()
    expect(tryToGoldGrams(100_000, -1)).toBeNull()
    expect(tryToGoldGrams(100_000, null)).toBeNull()
    expect(tryToGoldGrams(100_000, undefined)).toBeNull()
    expect(tryToGoldGrams(100_000, NaN)).toBeNull()
  })

  it('returns null for non-finite amount', () => {
    expect(tryToGoldGrams(Infinity, 4000)).toBeNull()
    expect(tryToGoldGrams(NaN, 4000)).toBeNull()
  })

  it('handles negative TRY (debt scenario)', () => {
    expect(tryToGoldGrams(-40_000, 4000)).toBe(-10)
  })
})

describe('tryToUsd', () => {
  it('divides TRY by USD rate and rounds to 2 decimals', () => {
    expect(tryToUsd(50_000, 50)).toBe(1000)
    expect(tryToUsd(100, 33)).toBe(3.03)
  })

  it('returns null for invalid rate', () => {
    expect(tryToUsd(50_000, 0)).toBeNull()
    expect(tryToUsd(50_000, null)).toBeNull()
    expect(tryToUsd(50_000, undefined)).toBeNull()
  })

  it('handles negative TRY', () => {
    expect(tryToUsd(-10_000, 50)).toBe(-200)
  })
})

describe('convertNetWorth', () => {
  const rates = { goldTry: 4000, usdTry: 50 }

  it('returns TRY as-is', () => {
    expect(convertNetWorth(500_000, 'TRY', rates)).toBe(500_000)
    expect(convertNetWorth(-100_000, 'TRY', rates)).toBe(-100_000)
  })

  it('converts to gold grams', () => {
    expect(convertNetWorth(400_000, 'GRA', rates)).toBe(100)
  })

  it('converts to USD', () => {
    expect(convertNetWorth(100_000, 'USD', rates)).toBe(2000)
  })

  it('returns null when rate missing', () => {
    expect(convertNetWorth(100_000, 'GRA', {})).toBeNull()
    expect(convertNetWorth(100_000, 'USD', {})).toBeNull()
    expect(convertNetWorth(100_000, 'GRA', { goldTry: null })).toBeNull()
  })
})

describe('formatRealValue', () => {
  it('formats gold grams with 2 decimal places', () => {
    expect(formatRealValue(12.5, 'GRA')).toBe('12,50 gr')
    expect(formatRealValue(100, 'GRA')).toBe('100,00 gr')
  })

  it('formats USD with dollar sign, no decimals', () => {
    expect(formatRealValue(2000, 'USD')).toBe('$2.000')
    expect(formatRealValue(-500, 'USD')).toBe('-$500')
  })

  it('formats TRY as a plain number (caller uses formatCurrency)', () => {
    // TRY path is a fallback; just ensure it returns a string
    const result = formatRealValue(100_000, 'TRY')
    expect(typeof result).toBe('string')
    expect(result).toBeTruthy()
  })
})

describe('realValueChangeBadge', () => {
  const rates = { goldTry: 4000, usdTry: 50 }

  it('returns null for TRY (caller handles it)', () => {
    expect(realValueChangeBadge(10_000, 'TRY', rates)).toBeNull()
  })

  it('returns positive change badge', () => {
    expect(realValueChangeBadge(40_000, 'GRA', rates)).toBe('+10,00 gr')
    expect(realValueChangeBadge(100_000, 'USD', rates)).toBe('+$2.000')
  })

  it('returns negative change badge without double minus', () => {
    expect(realValueChangeBadge(-40_000, 'GRA', rates)).toBe('-10,00 gr')
    expect(realValueChangeBadge(-50_000, 'USD', rates)).toBe('-$1.000')
  })

  it('returns null when rate missing', () => {
    expect(realValueChangeBadge(10_000, 'GRA', {})).toBeNull()
  })
})
