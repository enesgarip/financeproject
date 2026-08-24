import { describe, expect, it } from 'vitest'
import type { SavingsGoal } from '../types/database'
import {
  goalTargetAnchorLabel,
  goalTargetIsAnchored,
  goalTargetUnitsFor,
  resolveGoalTarget,
} from './goalTargetAnchor'
import type { MarketRatesSnapshot } from './marketRates'

const base = { id: 'g1', user_id: 'u', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    ...base,
    name: 'Hedef',
    value_type: 'TRY',
    target_amount: 0,
    current_amount: 0,
    estimated_value_try: null,
    auto_valued: false,
    valued_at: null,
    valuation_rate: null,
    target_date: null,
    status: 'active',
    note: null,
    target_anchor: 'manual',
    target_anchor_units: null,
    target_anchor_months: null,
    ...overrides,
  }
}

const snapshot: MarketRatesSnapshot = {
  rates: { GRA: { buying: 5000, selling: 5050 }, USD: { buying: 40, selling: 40.2 } },
  asOf: null,
  fetchedAt: '2026-08-24T09:00:00.000Z',
}

describe('resolveGoalTarget', () => {
  it('çıpasız hedefte null döner (saklanan tutar kullanılır)', () => {
    expect(resolveGoalTarget(goal(), { snapshot })).toBeNull()
  })

  it('altın çıpasında birim × canlı kur verir', () => {
    const resolved = resolveGoalTarget(goal({ target_anchor: 'gold', target_anchor_units: 200 }), { snapshot })

    expect(resolved?.amount).toBe(1_000_000)
    expect(resolved?.unitValue).toBe(5000)
    expect(resolved?.stale).toBe(false)
  })

  it('dolar çıpasında USD kurunu kullanır', () => {
    const resolved = resolveGoalTarget(goal({ target_anchor: 'usd', target_anchor_units: 25_000 }), { snapshot })

    expect(resolved?.amount).toBe(1_000_000)
  })

  it('kur yoksa saklanan tutara düşer ve bayat işaretler', () => {
    const resolved = resolveGoalTarget(
      goal({ target_anchor: 'gold', target_anchor_units: 200, target_amount: 900_000 }),
      { snapshot: null },
    )

    expect(resolved?.amount).toBe(900_000)
    expect(resolved?.stale).toBe(true)
  })

  it('gider katında ay × ortalama aylık çıkış verir', () => {
    const resolved = resolveGoalTarget(goal({ target_anchor: 'expense_months', target_anchor_months: 6 }), {
      monthlyOutflow: 45_000,
    })

    expect(resolved?.amount).toBe(270_000)
    expect(resolved?.unitValue).toBe(45_000)
  })

  it('gider verisi yoksa hedefi 0 göstermez ("ulaştın" yanılsaması olmasın)', () => {
    const resolved = resolveGoalTarget(
      goal({ target_anchor: 'expense_months', target_anchor_months: 6, target_amount: 250_000 }),
      { monthlyOutflow: 0 },
    )

    expect(resolved?.amount).toBe(250_000)
    expect(resolved?.stale).toBe(true)
  })
})

describe('goalTargetUnitsFor', () => {
  it('bugünkü TL tutarını grama çevirir', () => {
    expect(goalTargetUnitsFor('gold', 1_000_000, snapshot)).toBe(200)
  })

  it('kur yoksa ya da çıpa uygun değilse null', () => {
    expect(goalTargetUnitsFor('gold', 1_000_000, null)).toBeNull()
    expect(goalTargetUnitsFor('manual', 1_000_000, snapshot)).toBeNull()
    expect(goalTargetUnitsFor('expense_months', 1_000_000, snapshot)).toBeNull()
    expect(goalTargetUnitsFor('usd', 0, snapshot)).toBeNull()
  })
})

describe('goalTargetIsAnchored / etiket', () => {
  it('çıpayı ve etiketini bildirir', () => {
    expect(goalTargetIsAnchored(goal())).toBe(false)
    expect(goalTargetIsAnchored(goal({ target_anchor: 'usd' }))).toBe(true)
    expect(goalTargetAnchorLabel(goal({ target_anchor: 'gold', target_anchor_units: 200 }))).toBe('200 gram altın karşılığı')
    // 4 haneli saklanan birim rozette 2 haneye iner.
    expect(goalTargetAnchorLabel(goal({ target_anchor: 'gold', target_anchor_units: 139.4541 }))).toBe('139,45 gram altın karşılığı')
    expect(goalTargetAnchorLabel(goal({ target_anchor: 'expense_months', target_anchor_months: 6 }))).toBe('6 aylık gider')
    expect(goalTargetAnchorLabel(goal())).toBeNull()
  })
})
