import { describe, expect, it } from 'vitest'
import type { SavingsGoal, SavingsGoalComponent } from '../types/database'
import { formatCurrency } from './formatCurrency'
import {
  formatComponentAmount,
  formatSavingsGoalAmount,
  formatSavingsGoalProgress,
  savingsGoalProgressRate,
  savingsGoalValueTypeLabel,
} from './savingsGoal'

const base = { id: 'id', user_id: 'u', created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-06-01T00:00:00.000Z' }

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
  return {
    ...base,
    name: 'Hedef',
    value_type: 'gram_altin',
    target_amount: 0,
    current_amount: 0,
    estimated_value_try: 0,
    auto_valued: false,
    target_date: null,
    status: 'active',
    note: null,
    ...overrides,
  }
}

function component(overrides: Partial<SavingsGoalComponent>): SavingsGoalComponent {
  return { ...base, goal_id: 'g1', label: null, value_type: 'gram_altin', target_amount: 0, current_amount: 0, sort_order: 0, ...overrides }
}

describe('savingsGoalValueTypeLabel', () => {
  it('maps value types to Turkish unit labels', () => {
    expect(savingsGoalValueTypeLabel('gram_altin')).toBe('gram')
    expect(savingsGoalValueTypeLabel('ceyrek_altin')).toBe('çeyrek')
    expect(savingsGoalValueTypeLabel('composite')).toBe('karma')
    expect(savingsGoalValueTypeLabel('TRY')).toBe('TRY')
  })
})

describe('savingsGoalProgressRate', () => {
  it('computes a simple ratio and clamps at 100', () => {
    expect(savingsGoalProgressRate(goal({ target_amount: 10, current_amount: 4 }))).toBe(40)
    expect(savingsGoalProgressRate(goal({ target_amount: 10, current_amount: 20 }))).toBe(100)
    expect(savingsGoalProgressRate(goal({ target_amount: 0, current_amount: 5 }))).toBe(0)
  })

  it('averages component rates for composite goals and ignores other goals', () => {
    const composite = goal({ id: 'g1', value_type: 'composite' })
    const components = [
      component({ goal_id: 'g1', target_amount: 100, current_amount: 50 }), // 50%
      component({ goal_id: 'g1', target_amount: 200, current_amount: 200 }), // 100%
      component({ goal_id: 'g1', target_amount: 0, current_amount: 50 }), // 0% (no target)
      component({ goal_id: 'other', target_amount: 100, current_amount: 100 }), // different goal
    ]
    expect(savingsGoalProgressRate(composite, components)).toBe(50)
  })

  it('returns 0 for a composite goal with no components', () => {
    expect(savingsGoalProgressRate(goal({ id: 'g1', value_type: 'composite' }), [])).toBe(0)
  })
})

describe('formatSavingsGoalProgress', () => {
  it('summarises composite component completion', () => {
    const composite = goal({ id: 'g1', value_type: 'composite' })
    const components = [
      component({ goal_id: 'g1', target_amount: 100, current_amount: 50, sort_order: 1 }),
      component({ goal_id: 'g1', target_amount: 200, current_amount: 200, sort_order: 0 }),
      component({ goal_id: 'g1', target_amount: 0, current_amount: 50, sort_order: 2 }),
    ]
    expect(formatSavingsGoalProgress(composite, components)).toBe('1/3 bileşen tamam · %50')
  })

  it('handles an empty composite goal', () => {
    expect(formatSavingsGoalProgress(goal({ id: 'g1', value_type: 'composite' }))).toBe('Bileşen eklenmedi')
  })

  it('shows current over target for unit goals', () => {
    expect(formatSavingsGoalProgress(goal({ value_type: 'gram_altin', target_amount: 10, current_amount: 4 }))).toBe('4 gram / 10 gram')
  })
})

describe('amount formatting', () => {
  it('labels goal amounts by value type', () => {
    expect(formatSavingsGoalAmount(goal({ value_type: 'gram_altin' }), 50)).toBe('50 gram')
    expect(formatSavingsGoalAmount(goal({ value_type: 'ceyrek_altin' }), 3)).toBe('3 çeyrek')
    expect(formatSavingsGoalAmount(goal({ value_type: 'composite' }), 2)).toBe('2 bileşen')
    expect(formatSavingsGoalAmount(goal({ value_type: 'TRY' }), 1000)).toBe(formatCurrency(1000))
  })

  it('labels component amounts by value type', () => {
    expect(formatComponentAmount({ value_type: 'gram_altin' }, 5)).toBe('5 gram')
    expect(formatComponentAmount({ value_type: 'ceyrek_altin' }, 2)).toBe('2 çeyrek')
    expect(formatComponentAmount({ value_type: 'TRY' }, 1000)).toBe(formatCurrency(1000))
  })
})
