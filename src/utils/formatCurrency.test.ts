import { describe, expect, it } from 'vitest'
import { formatCompactCurrency, formatPercent } from './formatCurrency'

describe('formatPercent', () => {
  it('% sayıdan önce ve ondalık virgül (eskiden "16.2%" idi)', () => {
    expect(formatPercent(16.2)).toBe('%16,2')
    expect(formatPercent(59.94)).toBe('%59,9')
  })

  it('signed ile artı işareti öne gelir', () => {
    expect(formatPercent(16.2, { signed: true })).toBe('+%16,2')
    expect(formatPercent(0, { signed: true })).toBe('%0,0')
  })

  it('negatifte işaret yüzdenin önünde', () => {
    expect(formatPercent(-4.5)).toBe('-%4,5')
    expect(formatPercent(-4.5, { signed: true })).toBe('-%4,5')
  })

  it('null/undefined güvenli', () => {
    expect(formatPercent(null)).toBe('%0,0')
    expect(formatPercent(undefined)).toBe('%0,0')
  })
})

describe('formatCompactCurrency', () => {
  it('milyonu M ile kısaltır (eskiden "₺1787K" yazıyordu)', () => {
    expect(formatCompactCurrency(1_787_291)).toBe('₺1,8M')
  })

  it('bine yuvarlama milyon eşiğini aşınca "₺1.000K" üretmez', () => {
    expect(formatCompactCurrency(999_500)).toBe('₺1M')
    expect(formatCompactCurrency(-999_500)).toBe('-₺1M')
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
