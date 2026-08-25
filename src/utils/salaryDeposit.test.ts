import { describe, expect, it } from 'vitest'
import { findSalaryChangeCandidate, findSalaryDeposit } from './salaryDeposit'

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

describe('findSalaryChangeCandidate', () => {
  it('maaş bandı dışında ama makul büyüklükte girişi aday gösterir', () => {
    const candidate = findSalaryChangeCandidate([deposit('2026-09-01T08:00:00+03:00', 47500)], 42500)
    expect(candidate).toEqual({ matchedAt: '2026-09-01', amount: 47500 }) // ~%12 zam
  })

  it('maaş ±%10 bandında yattıysa değişiklik önermez', () => {
    const events = [deposit('2026-09-01', 42500), deposit('2026-09-03', 47500)]
    expect(findSalaryChangeCandidate(events, 42500)).toBeNull()
  })

  it('aynı gün eşit tutarlı çıkışı olan girişi transfer sayar ve eler', () => {
    const events = [
      deposit('2026-09-02T10:00:00+03:00', 50000), // hedefe giriş
      deposit('2026-09-02T10:00:00+03:00', -50000, 'withdrawal'), // kaynaktan çıkış
    ]
    expect(findSalaryChangeCandidate(events, 42500)).toBeNull()
  })

  it('bandın tümden dışını (yarısından az / 1,6 katından çok) elemez, aday yapmaz', () => {
    expect(findSalaryChangeCandidate([deposit('2026-09-01', 15000)], 42500)).toBeNull()
    expect(findSalaryChangeCandidate([deposit('2026-09-01', 118000)], 42500)).toBeNull()
  })

  it('kayıtlı maaş yokken susar (öneri ancak kıyasla anlamlı)', () => {
    expect(findSalaryChangeCandidate([deposit('2026-09-01', 47500)], null)).toBeNull()
  })
})
