import { describe, expect, it } from 'vitest'
import type { KasaBucket, SavingsGoal, SavingsGoalSource } from '../types/database'
import { bucketForGoal, buildGoalBucketPlan, isSameMonth } from './goalBucket'

const base = { id: 'id', user_id: 'u', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' }

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    ...base,
    id: 'g1',
    name: 'Ev peşinatı',
    value_type: 'TRY',
    target_amount: 600_000,
    current_amount: 0,
    estimated_value_try: null,
    auto_valued: false,
    valued_at: null,
    valuation_rate: null,
    target_date: '2026-12-31',
    status: 'active',
    note: null,
    target_anchor: 'manual',
    target_anchor_units: null,
    target_anchor_months: null,
    ...overrides,
  }
}

function bucket(overrides: Partial<KasaBucket> = {}): KasaBucket {
  return {
    ...base,
    id: 'b1',
    name: 'Ev peşinatı',
    reserved_amount: 50_000,
    sort_order: 0,
    note: null,
    goal_id: 'g1',
    last_contribution_month: null,
    ...overrides,
  }
}

function source(overrides: Partial<SavingsGoalSource> = {}): SavingsGoalSource {
  return {
    ...base,
    id: 's1',
    goal_id: 'g1',
    component_id: null,
    kind: 'kasa_bucket',
    asset_id: null,
    asset_category: null,
    card_id: null,
    bucket_id: 'b1',
    sort_order: 0,
    ...overrides,
  }
}

const today = new Date('2026-08-24T10:00:00')

describe('isSameMonth', () => {
  it('ayın ilk gününü aynı ay sayar, önceki ayı saymaz', () => {
    expect(isSameMonth('2026-08-01', today)).toBe(true)
    expect(isSameMonth('2026-07-01', today)).toBe(false)
    expect(isSameMonth(null, today)).toBe(false)
  })
})

describe('buildGoalBucketPlan', () => {
  it('aylık gerekliyi hedef tarihinden türetir', () => {
    const plan = buildGoalBucketPlan(goal(), bucket(), [], today)

    // 600.000 kalan / 5 ay (Ağustos sonu → Aralık sonu)
    expect(plan?.monthlyNeeded).toBeGreaterThan(0)
    expect(plan?.reserved).toBe(50_000)
    expect(plan?.contributedThisMonth).toBe(false)
  })

  it('bu ay ayrıldıysa işaretler', () => {
    const plan = buildGoalBucketPlan(goal(), bucket({ last_contribution_month: '2026-08-01' }), [], today)

    expect(plan?.contributedThisMonth).toBe(true)
  })

  it('kova aynı zamanda kaynaksa ilerlemeyi beslediğini söyler', () => {
    const linked = buildGoalBucketPlan(goal(), bucket(), [source()], today)
    const unlinked = buildGoalBucketPlan(goal(), bucket(), [source({ kind: 'asset_category', bucket_id: null, asset_category: 'Hisse' })], today)

    expect(linked?.fundsProgress).toBe(true)
    expect(unlinked?.fundsProgress).toBe(false)
  })

  it('hedef tarihi yoksa aylık plan üretmez', () => {
    const plan = buildGoalBucketPlan(goal({ target_date: null }), bucket(), [], today)

    expect(plan?.monthlyNeeded).toBe(0)
  })

  it('tamamlanmış hedefte plan 0 olur', () => {
    const plan = buildGoalBucketPlan(goal({ status: 'completed' }), bucket(), [], today)

    expect(plan?.monthlyNeeded).toBe(0)
  })

  it('kova yoksa plan yoktur', () => {
    expect(buildGoalBucketPlan(goal(), null, [], today)).toBeNull()
  })
})

describe('bucketForGoal', () => {
  it('hedefe bağlı kovayı bulur', () => {
    const rows = [bucket({ id: 'b0', goal_id: null }), bucket({ id: 'b1', goal_id: 'g1' })]

    expect(bucketForGoal('g1', rows)?.id).toBe('b1')
    expect(bucketForGoal('g2', rows)).toBeNull()
  })
})
