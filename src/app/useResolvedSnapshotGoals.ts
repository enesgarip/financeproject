import { useMemo } from 'react'
import type { FinanceSnapshot } from './useFinanceSnapshot'
import { useKasaBuckets } from '../hooks/useSafeToSpend'
import { useMarketRates } from '../hooks/useMarketRates'
import { useStockPrices } from '../hooks/useStockPrices'
import { resolveSavingsGoalRows } from '../utils/goalSources'
import { averageMonthlyOutflow } from '../utils/goalTargetAnchor'

/** Karar ve raporlar hedef paneliyle aynı kaynakları ve güven durumunu kullanır. */
export function useResolvedSnapshotGoals(snapshot: FinanceSnapshot | undefined) {
  const buckets = useKasaBuckets()
  const { snapshot: rates } = useMarketRates()
  const prices = useStockPrices(snapshot?.assets.map(asset => asset.symbol) ?? [])
  return useMemo(() => {
    const resolved = resolveSavingsGoalRows(snapshot?.savingsGoals ?? [], snapshot?.savingsGoalComponents ?? [], snapshot?.savingsGoalSources ?? [], {
      assets: snapshot?.assets ?? [], cards: snapshot?.cards, buckets: buckets.data,
      snapshot: rates, stockPrices: prices,
      monthlyOutflow: snapshot ? averageMonthlyOutflow(snapshot.transactionHistory, snapshot.payments, snapshot.cards) : null,
    })
    const reliableGoals = resolved.goals.filter(goal => {
      const sources = [resolved.goalResolutions.get(goal.id), ...resolved.components.filter(row => row.goal_id === goal.id).map(row => resolved.componentResolutions.get(row.id))]
      return !resolved.targetResolutions.get(goal.id)?.stale && sources.every(row => !row || (!row.missing.length && !row.unusable.length))
    })
    return { ...resolved, reliableGoals, incomplete: reliableGoals.length !== resolved.goals.length }
  }, [snapshot, buckets.data, rates, prices])
}
