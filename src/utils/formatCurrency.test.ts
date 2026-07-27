import { describe, expect, it } from 'vitest'
import { formatCompactCurrency } from './formatCurrency'

describe('formatCompactCurrency', () => {
  it('milyonu M ile kısaltır (eskiden "₺1787K" yazıyordu)', () => {
    expect(formatCompactCurrency(1_787_291)).toBe('₺1,8M')
  })

  it('bini K ile kısaltır', () => {
    expect(formatCompactCurrency(95_000)).toBe('₺95K')
    expect(formatCompactCurrency(18_500)).toBe('₺19K')
  })

  it('bin altını olduğu gibi yazar', () => {
    expect(formatCompactCurrency(940)).toBe('₺940')
    expect(formatCompactCurrency(0)).toBe('₺0')
  })

  it('işareti korur — negatif bakiye eksende görünmeli', () => {
    expect(formatCompactCurrency(-53_000)).toBe('-₺53K')
    expect(formatCompactCurrency(-2_400_000)).toBe('-₺2,4M')
  })

  it('tr-TR ondalık ayıracı kullanır (virgül)', () => {
    expect(formatCompactCurrency(1_250_000)).toContain(',')
    expect(formatCompactCurrency(1_250_000)).not.toContain('.')
  })

  it('null/undefined güvenli', () => {
    expect(formatCompactCurrency(null)).toBe('₺0')
    expect(formatCompactCurrency(undefined)).toBe('₺0')
  })
})
