import { describe, expect, it } from 'vitest'
import type { SavingsGoal } from '../types/database'
import type { CashFlowForecast, CashFlowForecastMonth } from './cashFlowForecast'
import { buildWishlistPlan } from './wishlistPlan'

const base = { id: 'g1', user_id: 'u', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    ...base,
    name: 'Borsa',
    value_type: 'TRY',
    target_amount: 1_000_000,
    current_amount: 0,
    estimated_value_try: null,
    auto_valued: false,
    valued_at: null,
    valuation_rate: null,
    // 5 ay → aylık gerekli 200.000
    target_date: '2026-12-31',
    status: 'active',
    note: null,
    ...overrides,
  }
}

function month(key: string, label: string, endingBalance: number): CashFlowForecastMonth {
  return {
    monthKey: key,
    monthLabel: label,
    income: 0,
    outflow: 0,
    net: 0,
    endingBalance,
    salary: 0,
    receivables: 0,
    paymentOutflow: 0,
    cardOutflow: 0,
    loanOutflow: 0,
    installmentOutflow: 0,
    debtOutflow: 0,
  }
}

const forecast: CashFlowForecast = {
  startingBalance: 20_000,
  endingBalance: 90_000,
  months: [
    month('2026-08', 'Ağustos 2026', 20_000),
    month('2026-09', 'Eylül 2026', 45_000),
    month('2026-10', 'Ekim 2026', 70_000),
    month('2026-11', 'Kasım 2026', 90_000),
  ],
  lowest: null,
  firstNegative: null,
}

const today = new Date('2026-08-24T10:00:00')

describe('buildWishlistPlan', () => {
  it('bugün karşılanan tutarda "şimdi alabilirsin" der', () => {
    const plan = buildWishlistPlan({ price: 5_000, forecast, safeToSpend: 8_000, floor: 10_000, goals: [] }, today)

    expect(plan?.affordableNow).toBe(true)
    expect(plan?.month).toBeNull()
  })

  it('tampon/rezerv tabanını bozmadan karşılanan ilk ayı bulur', () => {
    // Taban 10.000: Eylül'de 45.000-10.000=35.000 < 40.000; Ekim'de 60.000 >= 40.000.
    const plan = buildWishlistPlan({ price: 40_000, forecast, safeToSpend: 8_000, floor: 10_000, goals: [] }, today)

    expect(plan?.affordableNow).toBe(false)
    expect(plan?.month?.label).toBe('Ekim 2026')
  })

  it('ufukta hiç karşılanmıyorsa ay vermez (uydurmaz)', () => {
    const plan = buildWishlistPlan({ price: 500_000, forecast, safeToSpend: 0, floor: 10_000, goals: [] }, today)

    expect(plan?.month).toBeNull()
  })

  it('tutarı asıl beslenen hedefin aylık payına çevirir', () => {
    // Aylık gerekli 200.000; 400.000'lik istek ≈ 2 aylık pay.
    const plan = buildWishlistPlan(
      { price: 400_000, forecast, safeToSpend: 0, floor: 0, goals: [goal()] },
      today,
    )

    expect(plan?.goalName).toBe('Borsa')
    expect(plan?.goalMonths).toBe(2)
  })

  it('yarım aylık payın altındaki tutarda hedef cümlesi kurmaz', () => {
    // 20.000 / 200.000 = 0,1 ay → yuvarlanınca 0; "~1 aylık pay" demek şişirme olurdu.
    const plan = buildWishlistPlan({ price: 20_000, forecast, safeToSpend: 50_000, floor: 0, goals: [goal()] }, today)

    expect(plan?.goalMonths).toBe(0)
    expect(plan?.goalName).toBeNull()
  })

  it('birden çok hedefte en çok pay isteyeni kıyas alır', () => {
    const plan = buildWishlistPlan(
      {
        price: 400_000,
        forecast,
        safeToSpend: 0,
        floor: 0,
        goals: [goal({ id: 'g2', name: 'Tatil', target_amount: 100_000 }), goal()],
      },
      today,
    )

    expect(plan?.goalName).toBe('Borsa')
  })

  it('tarihsiz/altın/tamamlanmış hedefleri kıyasa katmaz', () => {
    const plan = buildWishlistPlan(
      {
        price: 400_000,
        forecast,
        safeToSpend: 0,
        floor: 0,
        goals: [
          goal({ target_date: null }),
          goal({ id: 'g3', value_type: 'gram_altin' }),
          goal({ id: 'g4', status: 'completed' }),
        ],
      },
      today,
    )

    expect(plan?.goalMonths).toBe(0)
    expect(plan?.goalName).toBeNull()
  })

  it('fiyatı olmayan maddede plan üretmez', () => {
    expect(buildWishlistPlan({ price: null, forecast, safeToSpend: 0, floor: 0, goals: [] }, today)).toBeNull()
    expect(buildWishlistPlan({ price: 0, forecast, safeToSpend: 0, floor: 0, goals: [] }, today)).toBeNull()
  })
})
