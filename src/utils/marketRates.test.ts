import { describe, expect, it } from 'vitest'
import {
  convertToTry,
  isSnapshotStale,
  type MarketRatesSnapshot,
  parseTruncgilFeed,
  parseTruncgilResponse,
  parseTruncgilText,
  parseUpdateDate,
  snapshotAgeHours,
  snapshotToUpsertPayload,
} from './marketRates'

const RAW = {
  Update_Date: '2026-06-04 00:21:01',
  USD: { Buying: 45.9556, Type: 'Currency', Selling: 45.9802, Change: 0.01 },
  EUR: { Buying: 49, Type: 'Currency', Selling: 49.2, Change: -0.1 },
  GBP: { Buying: 58, Type: 'Currency', Selling: 58.3, Change: 0.2 },
  GRA: { Buying: 6553.58, Type: 'Gold', Selling: 6554.44, Change: 0.5 },
  CEYREKALTIN: { Buying: 10568.49, Type: 'Gold', Selling: 10809.58, Change: 0.5 },
}

const SNAPSHOT: MarketRatesSnapshot = {
  rates: {
    USD: { buying: 45.9556, selling: 45.9802 },
    GRA: { buying: 6553.58, selling: 6554.44 },
    CEYREKALTIN: { buying: 10568.49, selling: 10809.58 },
  },
  asOf: '2026-06-03T21:21:01.000Z',
  fetchedAt: '2026-06-03T21:25:00.000Z',
}

describe('parseUpdateDate', () => {
  it('treats the feed time as Turkey local (+03:00) and returns UTC ISO', () => {
    expect(parseUpdateDate('2026-06-04 00:21:01')).toBe('2026-06-03T21:21:01.000Z')
  })

  it('returns null for unusable input', () => {
    expect(parseUpdateDate(undefined)).toBeNull()
    expect(parseUpdateDate('not-a-date')).toBeNull()
  })
})

describe('parseTruncgilResponse', () => {
  it('normalizes numeric buy/sell prices for every supported symbol', () => {
    const snapshot = parseTruncgilResponse(RAW, '2026-06-03T21:25:00.000Z')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.rates.USD).toEqual({ buying: 45.9556, selling: 45.9802 })
    expect(snapshot?.rates.GRA).toEqual({ buying: 6553.58, selling: 6554.44 })
    expect(snapshot?.rates.CEYREKALTIN?.selling).toBe(10809.58)
    expect(snapshot?.asOf).toBe('2026-06-03T21:21:01.000Z')
    expect(snapshot?.fetchedAt).toBe('2026-06-03T21:25:00.000Z')
  })

  it('accepts Turkish-formatted string prices', () => {
    const snapshot = parseTruncgilResponse({
      Update_Date: '2026-06-04 00:21:01',
      USD: { Buying: '45,9556', Selling: '45,9802' },
    })
    expect(snapshot?.rates.USD).toEqual({ buying: 45.9556, selling: 45.9802 })
  })

  it('skips symbols with missing or non-positive prices', () => {
    const snapshot = parseTruncgilResponse({
      USD: { Buying: 45.95, Selling: 46 },
      EUR: { Buying: 0, Selling: 49 },
      GBP: { Selling: 58 },
    })
    expect(snapshot?.rates.USD).toBeDefined()
    expect(snapshot?.rates.EUR).toBeUndefined()
    expect(snapshot?.rates.GBP).toBeUndefined()
  })

  it('returns null when nothing usable is present', () => {
    expect(parseTruncgilResponse(null)).toBeNull()
    expect(parseTruncgilResponse({ foo: 'bar' })).toBeNull()
    expect(parseTruncgilResponse('text')).toBeNull()
  })
})

describe('parseTruncgilFeed (tolerant)', () => {
  const FULL =
    '{"Update_Date":"2026-06-04 00:21:01",' +
    '"USD":{"Buying":45.9556,"Type":"Currency","Selling":45.9802,"Change":0.01},' +
    '"GRA":{"Buying":6553.58,"Selling":6554.44,"Type":"Gold"},' +
    '"CEYREKALTIN":{"Buying":10568.49,"Selling":10809.58,"Type":"Gold"}}'

  // The real feed occasionally cuts its long tail; reproduce a payload that is
  // valid up to the symbols we need and then truncated mid-object.
  const TRUNCATED = FULL.slice(0, -1) + ',"PALADYUM":{"Buying":1953.39,"Sell'

  it('uses the strict path for a complete document', () => {
    const snapshot = parseTruncgilFeed(FULL, '2026-06-03T21:25:00.000Z')
    expect(snapshot?.rates.USD).toEqual({ buying: 45.9556, selling: 45.9802 })
    expect(snapshot?.rates.CEYREKALTIN?.buying).toBe(10568.49)
  })

  it('recovers the needed symbols from a truncated payload', () => {
    expect(() => JSON.parse(TRUNCATED)).toThrow()
    const snapshot = parseTruncgilFeed(TRUNCATED, '2026-06-03T21:25:00.000Z')
    expect(snapshot).not.toBeNull()
    expect(snapshot?.rates.USD).toEqual({ buying: 45.9556, selling: 45.9802 })
    expect(snapshot?.rates.GRA).toEqual({ buying: 6553.58, selling: 6554.44 })
    expect(snapshot?.rates.CEYREKALTIN).toEqual({ buying: 10568.49, selling: 10809.58 })
    expect(snapshot?.asOf).toBe('2026-06-03T21:21:01.000Z')
  })

  it('parseTruncgilText returns null when no symbol can be extracted', () => {
    expect(parseTruncgilText('{"Update_Date":"2026-06-04 00:21:01","FOO":{')).toBeNull()
  })
})

describe('convertToTry', () => {
  it('passes TRY amounts through (rounded to 2 dp)', () => {
    expect(convertToTry(1234.567, 'TRY', SNAPSHOT, 'buying')).toBe(1234.57)
  })

  it('values gold quantity with the gram price', () => {
    expect(convertToTry(10, 'GRA', SNAPSHOT, 'buying')).toBe(65535.8)
  })

  it('uses the selling side when requested', () => {
    expect(convertToTry(100, 'USD', SNAPSHOT, 'selling')).toBe(4598.02)
    expect(convertToTry(100, 'USD', SNAPSHOT, 'buying')).toBe(4595.56)
  })

  it('returns null when the rate or snapshot is missing', () => {
    expect(convertToTry(10, 'GRA', null, 'buying')).toBeNull()
    expect(convertToTry(10, 'EUR', SNAPSHOT, 'buying')).toBeNull()
  })
})

describe('staleness', () => {
  it('measures age from the source time', () => {
    const now = new Date('2026-06-04T09:21:01.000Z')
    expect(snapshotAgeHours(SNAPSHOT, now)).toBeCloseTo(12, 5)
  })

  it('flags snapshots older than the threshold', () => {
    const now = new Date('2026-06-05T22:00:00.000Z')
    expect(isSnapshotStale(SNAPSHOT, 24, now)).toBe(true)
    expect(isSnapshotStale(SNAPSHOT, 24, new Date('2026-06-04T09:00:00.000Z'))).toBe(false)
    expect(isSnapshotStale(null)).toBe(true)
  })
})

describe('snapshotToUpsertPayload', () => {
  it('serializes each priced symbol with the snapshot time', () => {
    const payload = snapshotToUpsertPayload(SNAPSHOT)
    expect(payload).toHaveLength(3)
    expect(payload).toContainEqual({
      symbol: 'USD',
      buying: 45.9556,
      selling: 45.9802,
      fetched_at: '2026-06-03T21:21:01.000Z',
    })
  })
})
