import { sumTL } from './money'

/**
 * Shared statistics over monthly spending totals, so the analysis and anomaly
 * screens use ONE definition of "rolling average" instead of drifting apart
 * (one used ÷3 fixed, the other ÷active-months). Pure and unit-testable.
 */

/**
 * Average over the months that actually had spending. Dividing by a fixed window
 * (e.g. always ÷3) understates the baseline when a category only appears in some
 * months, which over-flags it as "above average". Months with 0 are ignored.
 */
export function averageOverActiveMonths(monthlyTotals: number[]): number {
  const active = monthlyTotals.filter((value) => value > 0)
  return active.length > 0 ? sumTL(active) / active.length : 0
}
