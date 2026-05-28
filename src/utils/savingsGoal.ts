import type { SavingsGoal } from '../types/database'
import { formatCurrency, formatNumber } from './formatCurrency'

export function savingsGoalValueTypeLabel(valueType: SavingsGoal['value_type']) {
  if (valueType === 'gram_altin') return 'gram'
  if (valueType === 'ceyrek_altin') return 'çeyrek'
  return 'TRY'
}

export function formatSavingsGoalAmount(goal: Pick<SavingsGoal, 'value_type' | 'target_amount' | 'current_amount'>, amount: number) {
  if (goal.value_type === 'TRY') return formatCurrency(amount)
  const unit = goal.value_type === 'gram_altin' ? 'gram' : 'çeyrek'
  return `${formatNumber(amount)} ${unit}`
}

export function formatSavingsGoalProgress(goal: SavingsGoal) {
  return `${formatSavingsGoalAmount(goal, goal.current_amount)} / ${formatSavingsGoalAmount(goal, goal.target_amount)}`
}
