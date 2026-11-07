import type { GoldLot, SavingsGoalMonthlyEntry, SavingsGoalMonthlyPlan } from '../types/database'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { toKurus } from './money'

export type GoalMonthlyPlan = SavingsGoalMonthlyPlan & { component_id?: string }
export type GoalMonthlyEntry = SavingsGoalMonthlyEntry & { component_id?: string }

export type GoalMonthlyRow = {
  month: string
  plan: GoalMonthlyPlan
  amount: number | null
  manual: boolean
  status: 'complete' | 'missed' | 'pending' | 'unknown'
}

/** Seçili takvim yılını üretir; önceki yıllara da arayüzden erişilir. */
export function buildGoalMonthlyRows(goalId: string, plans: GoalMonthlyPlan[], entries: GoalMonthlyEntry[], lots: GoldLot[], today = new Date(), year = today.getFullYear(), componentId?: string): GoalMonthlyRow[] {
  const todayKey = dateInputValue(today)
  const currentMonth = dateInputValue(startOfMonth(today))
  const versions = plans.filter(plan => plan.goal_id === goalId && plan.component_id === componentId).toSorted((a, b) => a.effective_month.localeCompare(b.effective_month))
  const rows: GoalMonthlyRow[] = []
  for (let i = 0; i < 12; i++) {
    const month = dateInputValue(addMonths(new Date(year, 0, 1), i))
    if (month > currentMonth) break
    const plan = versions.findLast(version => version.effective_month <= month)
    if (!plan) continue
    const entry = entries.find(row => row.goal_id === goalId && row.component_id === componentId && row.month === month)
    const goldType = plan.value_type === 'gram_altin' ? 'gram' : 'ceyrek'
    const buys = plan.source === 'gold_buys' ? lots.filter(lot => lot.direction === 'buy' && lot.gold_type === goldType && lot.purchase_date && lot.purchase_date.slice(0, 7) === month.slice(0, 7) && lot.purchase_date <= todayKey) : []
    // Miktar para değildir: mikrogram hassasiyetinde topla, TL yuvarlaması yapma.
    const automatic = buys.reduce((sum, lot) => sum + Math.round(lot.quantity * 1e6), 0) / 1e6
    const covered = plan.source === 'gold_buys' && plan.automatic_from !== null && month >= plan.automatic_from
    const amount = entry ? entry.amount : covered || buys.length > 0 ? automatic : null
    const complete = amount !== null && (plan.value_type === 'TRY' ? toKurus(amount) >= toKurus(plan.target_amount) : Math.round(amount * 1e6) >= Math.round(plan.target_amount * 1e6))
    const status = complete ? 'complete' : month === currentMonth ? 'pending' : entry || covered ? 'missed' : 'unknown'
    rows.push({ month, plan, amount, manual: !!entry, status })
  }
  return rows.reverse()
}
