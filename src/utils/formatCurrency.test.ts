import { describe, expect, it } from 'vitest'
import { formatCompactCurrency, formatPercent, formatSeritAmount, formatSeritParts, parseNumber } from './formatCurrency'

describe('parseNumber', () => {
  it('"k" kısaltmasını 1000 ile çarpar (eskiden çarpan uygulanmıyordu → "5k" 5 veriyordu)', () => {
    expect(parseNumber('5k')).toBe(5000)
    expect(parseNumber('5K')).toBe(5000)
    expect(parseNumber('2,5k')).toBe(2500)
    expect(parseNumber('10k')).toBe(10000)
  })

  it('Türkçe ve İngilizce yazımı tek sayıya çevirir', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56)
    expect(parseNumber('1234.56')).toBe(1234.56)
    expect(parseNumber('₺1.000')).toBe(1000)
    expect(parseNumber('1.500 TL')).toBe(1500)
  })

  it('boş/geçersiz girdi 0', () => {
    expect(parseNumber('')).toBe(0)
    expect(parseNumber(null)).toBe(0)
    expect(parseNumber('abc')).toBe(0)
  })
})

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

describe('formatSeritParts / formatSeritAmount', () => {
  it('sembolü sona alır ve varsayılan olarak ondalık göstermez', () => {
    expect(formatSeritAmount(12480)).toBe('12.480 ₺')
    expect(formatSeritAmount(1787291)).toBe('1.787.291 ₺')
    expect(formatSeritParts(12480)).toEqual({ amount: '12.480', unit: '₺' })
  })

  it('yuvarlar; kuruş isteniyorsa tr-TR virgülüyle verir', () => {
    expect(formatSeritAmount(12480.62)).toBe('12.481 ₺')
    expect(formatSeritAmount(12480.62, { decimals: 2 })).toBe('12.480,62 ₺')
  })

  it('negatifte ASCII tire değil U+2212 kullanır (monospace hizası)', () => {
    expect(formatSeritParts(-8940).amount).toBe('−8.940')
    expect(formatSeritParts(-8940).amount.startsWith('-')).toBe(false)
  })

  it('signed yalnız pozitife + koyar, sıfıra koymaz', () => {
    expect(formatSeritParts(62000, { signed: true }).amount).toBe('+62.000')
    expect(formatSeritParts(0, { signed: true }).amount).toBe('0')
    expect(formatSeritParts(-100, { signed: true }).amount).toBe('−100')
  })

  it('null/undefined güvenli', () => {
    expect(formatSeritAmount(null)).toBe('0 ₺')
    expect(formatSeritAmount(undefined)).toBe('0 ₺')
  })
})
