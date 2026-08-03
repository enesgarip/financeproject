import { describe, expect, it } from 'vitest'
import {
  amountsMatchForImport,
  descriptionsCompatibleForImport,
  importAmountTolerance,
  selectImportMatchIndex,
  type ImportMatchCandidate,
} from './importMatch'

describe('importAmountTolerance', () => {
  it('uses the 5 TL floor for small transactions', () => {
    expect(importAmountTolerance(170, 174)).toBe(5)
  })

  it('scales to 1% for large transactions', () => {
    expect(importAmountTolerance(10000, 10000)).toBe(100)
    expect(importAmountTolerance(535, 535)).toBeCloseTo(5.35, 2)
  })
})

describe('amountsMatchForImport', () => {
  it('matches within the 5 TL floor on small amounts', () => {
    expect(amountsMatchForImport(170, 174.5)).toBe(true)
    expect(amountsMatchForImport(170, 175.01)).toBe(false)
  })

  it('matches within 1% on large amounts', () => {
    expect(amountsMatchForImport(10000, 10080)).toBe(true) // 80 <= 100
    expect(amountsMatchForImport(10000, 10120)).toBe(false) // 120 > 100
  })

  it('treats the tolerance boundary as a match', () => {
    expect(amountsMatchForImport(10000, 10100)).toBe(true) // exactly 1%
  })
})

describe('descriptionsCompatibleForImport', () => {
  it('treats empty descriptions as compatible (no info to reject)', () => {
    expect(descriptionsCompatibleForImport('', 'MIGROS')).toBe(true)
    expect(descriptionsCompatibleForImport('MIGROS', null)).toBe(true)
  })

  it('matches on substring and shared tokens', () => {
    expect(descriptionsCompatibleForImport('UNDEM PETROL', 'undem petrol bursa')).toBe(true)
    expect(descriptionsCompatibleForImport('MEDIA MARKT MEDIA', 'Media Markt')).toBe(true)
  })

  it('rejects unrelated merchants', () => {
    expect(descriptionsCompatibleForImport('Market alışverişi', 'Eczane')).toBe(false)
  })
})

describe('selectImportMatchIndex', () => {
  const candidate = (
    index: number,
    distance: number,
    descriptionCompatible = true,
  ): ImportMatchCandidate => ({ index, distance, descriptionCompatible })

  it('prefers same-day description-compatible candidates', () => {
    expect(selectImportMatchIndex([candidate(0, 0, false), candidate(1, 0, true)])).toBe(1)
  })

  it('accepts a lone same-day candidate even when description is blind', () => {
    expect(selectImportMatchIndex([candidate(3, 0, false)])).toBe(3)
  })

  it('does not arbitrarily pick between two same-day, incompatible candidates', () => {
    expect(selectImportMatchIndex([candidate(0, 0, false), candidate(1, 0, false)])).toBeUndefined()
  })

  it('accepts a lone near candidate blindly (<= 3 days)', () => {
    expect(selectImportMatchIndex([candidate(2, 3, false)])).toBe(2)
  })

  it('requires description compatibility in the far window (4-7 days)', () => {
    expect(selectImportMatchIndex([candidate(0, 6, false)])).toBeUndefined()
    expect(selectImportMatchIndex([candidate(0, 6, true)])).toBe(0)
  })

  it('never matches beyond the loose window', () => {
    expect(selectImportMatchIndex([candidate(0, 8, true)])).toBeUndefined()
  })

  it('prefers nearer dates within the same tier', () => {
    expect(selectImportMatchIndex([candidate(0, 3, true), candidate(1, 1, true)])).toBe(1)
  })

  it('prefers an exact date over a near one', () => {
    expect(selectImportMatchIndex([candidate(0, 2, true), candidate(1, 0, false)])).toBe(1)
  })
})
