import type { SavingsGoal, SavingsGoalComponent, SavingsGoalValueType } from '../types/database'
import { formatCurrency, formatNumber } from './formatCurrency'
import { exceedsTL } from './money'

export function savingsGoalValueTypeLabel(valueType: SavingsGoalValueType) {
  if (valueType === 'gram_altin') return 'gram'
  if (valueType === 'ceyrek_altin') return 'çeyrek'
  if (valueType === 'composite') return 'karma'
  return 'TRY'
}

export function formatSavingsGoalAmount(
  goal: Pick<SavingsGoal, 'value_type' | 'target_amount' | 'current_amount'>,
  amount: number,
) {
  if (goal.value_type === 'TRY') return formatCurrency(amount)
  if (goal.value_type === 'composite') return `${formatNumber(amount)} bileşen`
  const unit = goal.value_type === 'gram_altin' ? 'gram' : 'çeyrek'
  return `${formatNumber(amount)} ${unit}`
}

export function formatComponentAmount(component: Pick<SavingsGoalComponent, 'value_type'>, amount: number) {
  if (component.value_type === 'TRY') return formatCurrency(amount)
  const unit = component.value_type === 'gram_altin' ? 'gram' : 'çeyrek'
  return `${formatNumber(amount)} ${unit}`
}

export function savingsGoalProgressRate(
  goal: SavingsGoal,
  components: SavingsGoalComponent[] = [],
) {
  if (goal.value_type === 'composite') {
    const rows = components.filter((item) => item.goal_id === goal.id)
    if (rows.length === 0) return 0
    const rates = rows.map((row) => (row.target_amount > 0 ? Math.min(100, (row.current_amount / row.target_amount) * 100) : 0))
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length
  }

  return goal.target_amount > 0 ? Math.min(100, (goal.current_amount / goal.target_amount) * 100) : 0
}

export function savingsGoalTargetReached(
  row: Pick<SavingsGoal | SavingsGoalComponent, 'target_amount' | 'current_amount'>,
) {
  return row.target_amount > 0 && !exceedsTL(row.target_amount, row.current_amount)
}

export function savingsGoalBelowTarget(
  row: Pick<SavingsGoal | SavingsGoalComponent, 'target_amount' | 'current_amount'>,
) {
  return row.target_amount > 0 && exceedsTL(row.target_amount, row.current_amount)
}

export function formatSavingsGoalProgress(goal: SavingsGoal, components: SavingsGoalComponent[] = []) {
  if (goal.value_type === 'composite') {
    const rows = components
      .filter((item) => item.goal_id === goal.id)
      .sort((a, b) => a.sort_order - b.sort_order)

    if (rows.length === 0) return 'Bileşen eklenmedi'

    const completedCount = rows.filter(savingsGoalTargetReached).length
    const rates = rows.map((row) => (row.target_amount > 0 ? Math.min(100, (row.current_amount / row.target_amount) * 100) : 0))
    const averageRate = rates.reduce((sum, rate) => sum + rate, 0) / rows.length

    return `${completedCount}/${rows.length} bileşen tamam · %${Math.round(averageRate)}`
  }

  return `${formatSavingsGoalAmount(goal, goal.current_amount)} / ${formatSavingsGoalAmount(goal, goal.target_amount)}`
}
