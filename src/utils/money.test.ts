import { describe, expect, it } from 'vitest'
import {
  addKurus,
  diffTL,
  equalsTL,
  exceedsTL,
  greaterThanTL,
  moneyDiffers,
  roundTL,
  subKurus,
  sumKurus,
  sumTL,
  toKurus,
  toTL,
} from './money'

describe('toKurus', () => {
  it('converts whole and fractional TL to integer kuruş', () => {
    expect(toKurus(1)).toBe(100)
    expect(toKurus(12.34)).toBe(1234)
    expect(toKurus(0.01)).toBe(1)
  })

  it('kills binary float representation error', () => {
    expect(toKurus(0.1 + 0.2)).toBe(30) // 0.30000000000000004 → 30
    expect(toKurus(2.675)).toBe(268) // klasik 2.675*100=267.4999… tuzağı
  })

  it('rounds half away from zero symmetrically', () => {
    expect(toKurus(1.005)).toBe(101)
    expect(toKurus(-1.005)).toBe(-101)
    expect(toKurus(-2.675)).toBe(-268)
  })

  it('guards null / undefined / NaN / Infinity', () => {
    expect(toKurus(null)).toBe(0)
    expect(toKurus(undefined)).toBe(0)
    expect(toKurus(NaN)).toBe(0)
    expect(toKurus(Infinity)).toBe(0)
  })
})

describe('toTL', () => {
  it('converts kuruş back to TL', () => {
    expect(toTL(1234)).toBe(12.34)
    expect(toTL(1)).toBe(0.01)
    expect(toTL(0)).toBe(0)
  })

  it('truncates stray sub-kuruş input and guards bad values', () => {
    expect(toTL(1234.9)).toBe(12.34)
    expect(toTL(null)).toBe(0)
    expect(toTL(NaN)).toBe(0)
  })

  it('round-trips through toKurus', () => {
    for (const tl of [0, 0.01, 12.34, 9999.99, -45.67]) {
      expect(toTL(toKurus(tl))).toBe(tl)
    }
  })
})

describe('roundTL', () => {
  it('removes float dust', () => {
    expect(roundTL(0.1 + 0.2)).toBe(0.3)
    expect(roundTL(1.1 * 3)).toBe(3.3) // 3.3000000000000003 → 3.3
  })

  it('rounds to 2 decimal places', () => {
    expect(roundTL(1.005)).toBe(1.01)
    expect(roundTL(1.004)).toBe(1)
    expect(roundTL(1234.567)).toBe(1234.57)
    expect(roundTL(-1.234)).toBe(-1.23)
  })
})

describe('integer kuruş ops', () => {
  it('addKurus / subKurus / sumKurus are exact', () => {
    expect(addKurus(10, 20)).toBe(30)
    expect(subKurus(100, 30)).toBe(70)
    expect(sumKurus([10, 20, 30])).toBe(60)
    expect(sumKurus([])).toBe(0)
  })

  it('truncates non-integer kuruş inputs defensively', () => {
    expect(addKurus(10.9, 20.9)).toBe(30)
  })
})

describe('sumTL', () => {
  it('sums TL floats exactly via kuruş', () => {
    expect(sumTL([0.1, 0.2])).toBe(0.3)
    expect(sumTL([0.1, 0.1, 0.1])).toBe(0.3)
    expect(sumTL([12.34, 56.78, 0.01])).toBe(69.13)
  })

  it('skips nullish entries', () => {
    expect(sumTL([10, null, 5, undefined])).toBe(15)
    expect(sumTL([])).toBe(0)
  })

  it('beats a naive float reduce', () => {
    const naive = [0.1, 0.2].reduce((a, b) => a + b, 0)
    expect(naive).not.toBe(0.3) // çıplak float toza biner
    expect(sumTL([0.1, 0.2])).toBe(0.3)
  })
})

describe('equalsTL (tolerance hack replacement)', () => {
  it('treats kuruş-equal floats as equal', () => {
    expect(equalsTL(0.1 + 0.2, 0.3)).toBe(true)
    expect(equalsTL(100, 100.004)).toBe(true) // < yarım kuruş
    expect(equalsTL(100, 100.01)).toBe(false)
  })

  it('handles nullish as zero', () => {
    expect(equalsTL(null, 0)).toBe(true)
    expect(equalsTL(undefined, undefined)).toBe(true)
  })
})

describe('moneyDiffers', () => {
  it('returns false when both values round to the same cent', () => {
    expect(moneyDiffers(100.001, 100.002)).toBe(false)
  })

  it('returns true when values differ more than 1 cent', () => {
    expect(moneyDiffers(100, 100.02)).toBe(true)
  })
})

describe('greaterThanTL / diffTL', () => {
  it('compares at kuruş precision', () => {
    expect(greaterThanTL(100.01, 100)).toBe(true)
    expect(greaterThanTL(100.004, 100)).toBe(false)
  })

  it('diffTL returns signed exact difference', () => {
    expect(diffTL(100.3, 100)).toBe(0.3)
    expect(diffTL(0.1 + 0.2, 0.3)).toBe(0)
    expect(diffTL(50, 75.5)).toBe(-25.5)
  })
})

describe('exceedsTL (+0.01 tolerance guard replacement)', () => {
  it('keeps the 1-kuruş grace: fires only when a exceeds b by ≥ 2 kuruş', () => {
    // eski `a > b + 0.01` davranışı birebir
    expect(exceedsTL(100.02, 100)).toBe(true) // 2 kuruş fazla → uyar
    expect(exceedsTL(100.01, 100)).toBe(false) // 1 kuruş grace içinde
    expect(exceedsTL(100, 100)).toBe(false)
    expect(exceedsTL(99.99, 100)).toBe(false)
  })

  it('is directional, unlike equalsTL/diffTL', () => {
    expect(exceedsTL(100, 100.02)).toBe(false)
    expect(exceedsTL(100.02, 100)).toBe(true)
  })

  it('compares against zero for ">0.01" style guards', () => {
    expect(exceedsTL(0.02, 0)).toBe(true)
    expect(exceedsTL(0.01, 0)).toBe(false) // grace
    expect(exceedsTL(0, 0)).toBe(false)
  })

  it('removes float dust from the comparison', () => {
    // 0.1 + 0.2 = 0.30000000000000004; çıplak `> 0.3 + 0.01` davranışı kuruşta kesin
    expect(exceedsTL(0.1 + 0.2, 0.3)).toBe(false)
  })

  it('honours an explicit tolerance and nullish operands', () => {
    expect(exceedsTL(100.05, 100, 0)).toBe(true) // 0 tolerans = greaterThanTL gibi
    expect(exceedsTL(null, null)).toBe(false)
    expect(exceedsTL(0.05, null)).toBe(true)
  })
})
