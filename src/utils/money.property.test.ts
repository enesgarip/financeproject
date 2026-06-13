import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  addKurus,
  diffTL,
  equalsTL,
  exceedsTL,
  greaterThanTL,
  roundTL,
  subKurus,
  sumKurus,
  sumTL,
  toKurus,
  toTL,
} from './money'

/**
 * Property-based (fast-check) kanıtları — money çekirdeğinin "her girdi için"
 * tutması gereken değişmezleri. Example-based money.test.ts somut tuzakları,
 * burası ise genel cebiri (round-trip, işaret simetrisi, sıra bağımsızlığı,
 * trichotomy) rastgele girdiyle tarar. Kuruş modelinin tüm varlık sebebi:
 * toplama/eşitlik float sırasından/tozundan bağımsız ve KESİN olsun.
 */

// Tek kullanıcılık finans için fazlasıyla geniş, float hassasiyetinin integer-liği
// bozmadığı güvenli aralık (±1 milyar TL).
const moneyArb = fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true })
// Tam sayı kuruş (±100 milyar kuruş = ±1 milyar TL).
const kurusArb = fc.integer({ min: -1e11, max: 1e11 })

describe('money — toKurus / toTL cebiri', () => {
  it('toKurus her zaman tam sayı üretir', () => {
    fc.assert(fc.property(moneyArb, (x) => Number.isInteger(toKurus(x))))
  })

  it('kuruş → TL → kuruş tam round-trip (identity)', () => {
    fc.assert(fc.property(kurusArb, (k) => toKurus(toTL(k)) === k))
  })

  it('toKurus işaret-simetriktir: toKurus(-x) === -toKurus(x)', () => {
    fc.assert(fc.property(moneyArb, (x) => toKurus(-x) === -toKurus(x)))
  })

  it('toTL asla -0 sızdırmaz', () => {
    fc.assert(fc.property(kurusArb, (k) => !Object.is(toTL(k), -0)))
  })
})

describe('money — roundTL', () => {
  it('idempotenttir: roundTL(roundTL(x)) === roundTL(x)', () => {
    fc.assert(fc.property(moneyArb, (x) => roundTL(roundTL(x)) === roundTL(x)))
  })

  it('kuruş hassasiyetini korur: toKurus(roundTL(x)) === toKurus(x)', () => {
    fc.assert(fc.property(moneyArb, (x) => toKurus(roundTL(x)) === toKurus(x)))
  })
})

describe('money — sumTL / sumKurus (kuruş modelinin asıl vaadi)', () => {
  it('sumTL = kuruş projeksiyonu (float toz yok)', () => {
    fc.assert(
      fc.property(fc.array(moneyArb, { maxLength: 50 }), (values) => {
        expect(toKurus(sumTL(values))).toBe(sumKurus(values.map(toKurus)))
      }),
    )
  })

  it('sumTL eleman sırasından BAĞIMSIZ (float reduce değildir)', () => {
    fc.assert(
      fc.property(fc.array(moneyArb, { maxLength: 50 }), (values) => {
        const shuffled = [...values].reverse()
        expect(equalsTL(sumTL(values), sumTL(shuffled))).toBe(true)
      }),
    )
  })

  it('addKurus/subKurus tam sayı kuruşta kesindir', () => {
    fc.assert(
      fc.property(kurusArb, kurusArb, (a, b) => {
        expect(addKurus(a, b)).toBe(a + b)
        expect(subKurus(a, b)).toBe(a - b)
      }),
    )
  })
})

describe('money — karşılaştırma değişmezleri', () => {
  it('equalsTL tam olarak toKurus eşitliğidir (sözleşme)', () => {
    fc.assert(fc.property(moneyArb, moneyArb, (a, b) => equalsTL(a, b) === (toKurus(a) === toKurus(b))))
  })

  it('equalsTL refleksif ve simetriktir', () => {
    fc.assert(fc.property(moneyArb, (a) => equalsTL(a, a)))
    fc.assert(fc.property(moneyArb, moneyArb, (a, b) => equalsTL(a, b) === equalsTL(b, a)))
  })

  it('trichotomy: >, < ve = tam olarak biri doğrudur', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, (a, b) => {
        const gt = greaterThanTL(a, b)
        const lt = greaterThanTL(b, a)
        const eq = equalsTL(a, b)
        return [gt, lt, eq].filter(Boolean).length === 1
      }),
    )
  })

  it('diffTL ters-simetriktir: kuruş(diffTL(a,b)) === -kuruş(diffTL(b,a))', () => {
    fc.assert(fc.property(moneyArb, moneyArb, (a, b) => toKurus(diffTL(a, b)) === -toKurus(diffTL(b, a))))
  })
})

describe('money — exceedsTL (C3 tolerans guard ikizi)', () => {
  it('sıfır toleransta greaterThanTL ile aynıdır', () => {
    fc.assert(fc.property(moneyArb, moneyArb, (a, b) => exceedsTL(a, b, 0) === greaterThanTL(a, b)))
  })

  it('negatif olmayan toleransta ters-simetriktir (ikisi aynı anda aşamaz)', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, fc.integer({ min: 0, max: 100 }), (a, b, tol) => {
        if (exceedsTL(a, b, tol)) return !exceedsTL(b, a, tol)
        return true
      }),
    )
  })

  it('aştığında fark toleransı geçer: kuruş(a) − kuruş(b) > tol', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, fc.integer({ min: 0, max: 100 }), (a, b, tol) => {
        if (exceedsTL(a, b, tol)) return toKurus(a) - toKurus(b) > tol
        return true
      }),
    )
  })
})
