import { describe, expect, it } from 'vitest'
import type { KasaBucket, SavingsGoal } from '../types/database'
import type { BudgetUsage } from './budgetAlerts'
import { buildBudgetSurplusBridge } from './budgetBridge'

// Ağustos 2026'nın son günleri: 29/30/31'de pencere açık (kalan gün ≤ 2).
const LAST_DAYS = new Date('2026-08-30T12:00:00')
const MID_MONTH = new Date('2026-08-20T12:00:00')

let seq = 0
function usage(overrides: Partial<BudgetUsage>): BudgetUsage {
  seq += 1
  return {
    budgetId: `b${seq}`,
    category: 'Market',
    spent: 4000,
    limit: 6000,
    usageRate: 66,
    status: 'ok',
    remaining: 2000,
    anchorLabel: null,
    ...overrides,
  }
}

function goal(overrides: Partial<SavingsGoal> & Pick<SavingsGoal, 'id'>): SavingsGoal {
  return {
    user_id: 'u1',
    created_at: '',
    updated_at: '',
    name: `Hedef ${overrides.id}`,
    value_type: 'TRY',
    target_amount: 100000,
    current_amount: 10000,
    target_date: '2027-06-30',
    status: 'active',
    note: null,
    ...overrides,
  } as SavingsGoal
}

function bucket(id: string, goalId: string): KasaBucket {
  return { id, goal_id: goalId, name: `Kova ${id}`, reserved_amount: 0, last_contribution_month: null } as KasaBucket
}

describe('buildBudgetSurplusBridge', () => {
  it('ayın son günlerinde artığı toplar ve en çok isteyen kovalı hedefi seçer', () => {
    const bridge = buildBudgetSurplusBridge(
      [usage({ remaining: 2000 }), usage({ remaining: 1200, category: 'Ulaşım' }), usage({ remaining: 500, limit: 0 })],
      [
        goal({ id: 'g-az', target_amount: 50000 }), // aylık gerekli daha düşük
        goal({ id: 'g-cok', target_amount: 400000 }), // en çok isteyen
        goal({ id: 'g-kovasiz', target_amount: 900000 }), // kovası yok — elenir
      ],
      [bucket('k1', 'g-az'), bucket('k2', 'g-cok')],
      LAST_DAYS,
    )
    expect(bridge).toEqual({
      surplus: 3200, // limitsiz satırın kalanı sayılmaz
      goalId: 'g-cok',
      goalName: 'Hedef g-cok',
      bucketId: 'k2',
      bucketName: 'Kova k2',
    })
  })

  it('ay ortasında susar (kalan bütçe artık değil plan)', () => {
    expect(
      buildBudgetSurplusBridge([usage({})], [goal({ id: 'g1' })], [bucket('k1', 'g1')], MID_MONTH),
    ).toBeNull()
  })

  it('küçük artıkta ve kovalı hedef yokken susar', () => {
    expect(buildBudgetSurplusBridge([usage({ remaining: 60 })], [goal({ id: 'g1' })], [bucket('k1', 'g1')], LAST_DAYS)).toBeNull()
    expect(buildBudgetSurplusBridge([usage({})], [goal({ id: 'g1' })], [], LAST_DAYS)).toBeNull()
    expect(
      buildBudgetSurplusBridge([usage({})], [goal({ id: 'g1', status: 'completed' })], [bucket('k1', 'g1')], LAST_DAYS),
    ).toBeNull()
  })
})
