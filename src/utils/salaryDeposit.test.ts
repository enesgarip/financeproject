import { describe, expect, it } from 'vitest'
import { findSalaryDeposit } from './salaryDeposit'

function deposit(occurredAt: string, amountTL: number, kind: 'deposit' | 'withdrawal' | 'opening' = 'deposit') {
  return { kind, occurred_at: occurredAt, amount_kurus: Math.round(amountTL * 100) }
}

describe('findSalaryDeposit', () => {
  it('maaşın ±%10 bandındaki ilk yatışı eşler', () => {
    const match = findSalaryDeposit(
      [
        deposit('2026-08-03T09:15:00+03:00', 1250), // küçük giriş, eşleşmez
        deposit('2026-08-01T08:00:00+03:00', 42500), // maaş (tam)
        deposit('2026-08-05T10:00:00+03:00', 43000), // ikinci benzer — ilki kazanır
      ],
      42500,
    )
    expect(match).toEqual({ matchedAt: '2026-08-01', amount: 42500 })
  })

  it('band dışını, çıkışları ve maaşsız durumu eler', () => {
    expect(findSalaryDeposit([deposit('2026-08-01', 36000)], 42500)).toBeNull() // %15 sapma
    expect(findSalaryDeposit([deposit('2026-08-01', 42500, 'withdrawal')], 42500)).toBeNull()
    expect(findSalaryDeposit([deposit('2026-08-01', 42500)], null)).toBeNull()
    expect(findSalaryDeposit([], 42500)).toBeNull()
  })

  it('band içi sapmayı kabul eder (kesinti/prim toleransı)', () => {
    expect(findSalaryDeposit([deposit('2026-08-02', 40000)], 42500)).not.toBeNull() // ~%5,9
  })
})
