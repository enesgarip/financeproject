import { describe, expect, it } from 'vitest'
import { getBankBrand } from './bankBranding'

describe('getBankBrand', () => {
  it('matches Turkish and ASCII İş Bankası spellings', () => {
    expect(getBankBrand('İŞ BANKASI')).toMatchObject({ matched: true, code: 'İŞ' })
    expect(getBankBrand('IS BANKASI')).toMatchObject({ matched: true, code: 'İŞ' })
  })

  // Denetim 2026-08-12 §9: dört eşleşme kusuru.
  it('matches short bank codes only as whole words', () => {
    // ING/TEB/PTT tam kelime olarak eşleşir...
    expect(getBankBrand('ING Bank')).toMatchObject({ matched: true, code: 'ING' })
    expect(getBankBrand('TEB')).toMatchObject({ matched: true, code: 'TEB' })
    // ...eski ' ptt'/'ptt ' boşluk şartı tek kelimelik adı kaçırıyordu.
    expect(getBankBrand('PTT')).toMatchObject({ matched: true, code: 'PT' })
    // ...ama çıplak substring yanlış pozitifi artık üretilmiyor.
    expect(getBankBrand('Sterling Finans')).toMatchObject({ matched: false })
    expect(getBankBrand('Integral Yatırım')).toMatchObject({ matched: false })
  })

  it('gives Enpara its own identity instead of falling into QNB', () => {
    // QNB'nin 'enpara' anahtarı bu girdiyi tümden erişilemez kılıyordu.
    expect(getBankBrand('Enpara')).toMatchObject({ matched: true, code: 'EN' })
    expect(getBankBrand('QNB Finansbank')).toMatchObject({ matched: true, code: 'QNB' })
  })

  it('matches Maximiles after the Turkish-İ normalization fold', () => {
    // Eski anahtar 'maximİles' büyük İ içerdiği için normalize edilmiş
    // (küçük harfe katlanmış) metinle ASLA eşleşmiyordu.
    expect(getBankBrand('MAXİMİLES')).toMatchObject({ matched: true, code: 'İŞ' })
    expect(getBankBrand('Maximiles Black')).toMatchObject({ matched: true, code: 'İŞ' })
  })

  it('keeps DenizBank ahead of the shared Bonus license', () => {
    expect(getBankBrand('Bonus Deniz')).toMatchObject({ matched: true, code: 'DB' })
    expect(getBankBrand('Bonus Garanti')).toMatchObject({ matched: true, code: 'GA' })
  })

  it('keeps fallback brand generation deterministic', () => {
    const first = getBankBrand('Acme Test Bankasi')
    const second = getBankBrand('Acme Test Bankasi')

    expect(first).toMatchObject({ matched: false, code: 'AT' })
    expect(second.color).toBe(first.color)
  })
})
