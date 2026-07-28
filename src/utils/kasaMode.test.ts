import { describe, expect, it } from 'vitest'
import { spendableAfterReserves, totalReservedTL } from './kasaMode'

const buckets = [
  { reserved_amount: 15_000 },
  { reserved_amount: 8_000 },
  { reserved_amount: 2_000 },
]

describe('kasaMode', () => {
  it('totalReservedTL kovaların rezervini toplar', () => {
    expect(totalReservedTL(buckets)).toBe(25_000)
    expect(totalReservedTL([])).toBe(0)
  })

  it('spendableAfterReserves = likit − rezerve', () => {
    expect(spendableAfterReserves(58_000, buckets)).toBe(33_000)
  })

  it('rezerve likidi aşarsa negatif döner (aşırı ayırma)', () => {
    expect(spendableAfterReserves(20_000, buckets)).toBe(-5_000)
  })

  it('kova yoksa harcanabilir = likit', () => {
    expect(spendableAfterReserves(58_000, [])).toBe(58_000)
  })
})
