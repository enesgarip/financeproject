/**
 * Fair "month so far" comparison helpers.
 *
 * Today is only N days into the current month, so comparing the running total to
 * a FULL previous month (or a full 3-month average) understates spending early in
 * the month and overstates it late. Clipping every month to the same
 * day-of-month window ("through day D") makes the current and historical totals
 * cover equal ground, so month-over-month % changes and anomaly ratios are
 * like-for-like instead of partial-vs-full. Pure and unit-testable.
 */

/** Day-of-month cutoff for a fair month-to-date comparison: today's day-of-month. */
export function dayOfMonthCutoff(now: Date = new Date()): number {
  return now.getDate()
}

/** True when an ISO date (YYYY-MM-DD…) falls on day 1..throughDay of its month. */
export function isWithinDayOfMonth(isoDate: string, throughDay: number): boolean {
  const day = Number(isoDate.slice(8, 10))
  return Number.isFinite(day) && day >= 1 && day <= throughDay
}
