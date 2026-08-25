import { describe, expect, it } from 'vitest'
import type { CardInstallment } from '../types/database'
import {
  buildPlannedInstallmentHint,
  findInstallmentReliefs,
  nextMonthInstallmentLoad,
} from './installmentHorizon'

const TODAY = new Date('2026-08-25T12:00:00')

let seq = 0
function inst(overrides: Partial<CardInstallment>): CardInstallment {
  seq += 1
  return {
    id: `i${seq}`,
    user_id: 'u1',
    created_at: '',
    updated_at: '',
    card_id: 'c1',
    card_expense_id: 'e1',
    statement_archive_id: null,
    installment_no: 1,
    installment_count: 3,
    due_month: '2026-09-01',
    amount: 1000,
    status: 'scheduled',
    posted_at: null,
    paid_at: null,
    ...overrides,
  } as CardInstallment
}

describe('nextMonthInstallmentLoad', () => {
  it('yalnız önümüzdeki ayın scheduled satırlarını toplar', () => {
    const load = nextMonthInstallmentLoad(
      [
        inst({ due_month: '2026-09-01', amount: 1200 }),
        inst({ due_month: '2026-09-15', amount: 800 }), // ay ortası tarih de aynı ay
        inst({ due_month: '2026-08-01', amount: 999 }), // bu ay: hariç
        inst({ due_month: '2026-10-01', amount: 999 }), // sonraki ay: hariç
        inst({ due_month: '2026-09-01', amount: 999, status: 'posted' }), // borçta zaten
      ],
      TODAY,
    )
    expect(load).toBe(2000)
  })
})

describe('buildPlannedInstallmentHint', () => {
  it('tek çekim ve tutarsız planlarda susar', () => {
    expect(buildPlannedInstallmentHint([], { amount: 9000, count: 1 }, TODAY)).toBeNull()
    expect(buildPlannedInstallmentHint([], { amount: null, count: 6 }, TODAY)).toBeNull()
    expect(buildPlannedInstallmentHint([], { amount: 0, count: 6 }, TODAY)).toBeNull()
  })

  it('aya düşen payı ve önümüzdeki ayın yeni yükünü verir', () => {
    const hint = buildPlannedInstallmentHint(
      [inst({ due_month: '2026-09-01', amount: 8200 })],
      { amount: 7500, count: 6 },
      TODAY,
    )
    expect(hint).toEqual({ perMonth: 1250, baseMonthly: 8200, newMonthly: 9450, months: 6 })
  })
})

describe('findInstallmentReliefs', () => {
  it('planın son ayını bulur, aynı ayda bitenleri toplar, geçmişi eler', () => {
    const reliefs = findInstallmentReliefs(
      [
        // Plan A: Eylül'de bitiyor, aylık 1.400.
        inst({ card_expense_id: 'a', due_month: '2026-08-01', amount: 1400 }),
        inst({ card_expense_id: 'a', due_month: '2026-09-01', amount: 1400 }),
        // Plan B: Eylül'de bitiyor, aylık 1.000.
        inst({ card_expense_id: 'b', due_month: '2026-09-01', amount: 1000 }),
        // Plan C: Kasım'da bitiyor.
        inst({ card_expense_id: 'c', due_month: '2026-10-01', amount: 500 }),
        inst({ card_expense_id: 'c', due_month: '2026-11-01', amount: 500 }),
        // Plan D: geçmişte bitmiş (Temmuz) — elenir.
        inst({ card_expense_id: 'd', due_month: '2026-07-01', amount: 900 }),
        // Plan E: posted satırlar plan sayılmaz.
        inst({ card_expense_id: 'e', due_month: '2026-09-01', amount: 900, status: 'posted' }),
      ],
      { today: TODAY },
    )
    expect(reliefs).toHaveLength(2)
    expect(reliefs[0]).toMatchObject({ monthKey: '2026-09-01', count: 2, monthlyDrop: 2400 })
    expect(reliefs[1]).toMatchObject({ monthKey: '2026-11-01', count: 1, monthlyDrop: 500 })
  })

  it('bağsız satır kendi başına plandır ve ufuk sınırı çalışır', () => {
    const reliefs = findInstallmentReliefs(
      [
        inst({ card_expense_id: null, due_month: '2026-10-01', amount: 750 }),
        inst({ card_expense_id: 'z', due_month: '2027-09-01', amount: 100 }), // 12 ay ufku dışında
      ],
      { today: TODAY },
    )
    expect(reliefs).toHaveLength(1)
    expect(reliefs[0]).toMatchObject({ monthKey: '2026-10-01', count: 1, monthlyDrop: 750 })
  })
})
