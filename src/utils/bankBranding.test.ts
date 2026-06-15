import { describe, expect, it } from 'vitest'
import { getBankBrand } from './bankBranding'

describe('getBankBrand', () => {
  it('matches Turkish and ASCII İş Bankası spellings', () => {
    expect(getBankBrand('İŞ BANKASI')).toMatchObject({ matched: true, code: 'İŞ' })
    expect(getBankBrand('IS BANKASI')).toMatchObject({ matched: true, code: 'İŞ' })
  })

  it('keeps fallback brand generation deterministic', () => {
    const first = getBankBrand('Acme Test Bankasi')
    const second = getBankBrand('Acme Test Bankasi')

    expect(first).toMatchObject({ matched: false, code: 'AT' })
    expect(second.color).toBe(first.color)
  })
})
