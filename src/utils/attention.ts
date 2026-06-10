import { buildCashFlowForecast } from './cashFlowForecast'
import { dateInputValue } from './date'
import { buildFinancialPosition, type FinanceSummaryInput } from './financeSummary'
import { formatCurrency } from './formatCurrency'
import { diffTL, greaterThanTL } from './money'

/**
 * The single most important sentence of the day (roadmap C7).
 *
 * Not a score, not a panel — one line at the top of the dashboard, or nothing.
 * Priority: an immediate cash shortfall in the next 7 days beats a structural
 * negative month in the forecast, which beats a "balance dips low" heads-up.
 * When there is nothing worth saying it returns null and the dashboard stays
 * quiet — silence is part of the design.
 */

export type AttentionLine = {
  tone: 'danger' | 'warning'
  text: string
}

export type AttentionUpcomingItem = {
  /** Cash leaving the accounts for this obligation (0 for card-settled rows). */
  cashImpactAmount: number
  settlement: 'cash' | 'credit_card'
  /** Epoch ms of the due date. */
  sortTime: number
  title: string
}

const SHORTFALL_WINDOW_DAYS = 7
const FORECAST_HORIZON_MONTHS = 3
/** "Dips low" = lowest projected balance under this share of today's cash. */
const LOW_BALANCE_RATIO = 0.25

export function buildAttentionLine(
  data: FinanceSummaryInput,
  upcomingItems: AttentionUpcomingItem[] = [],
  from: Date = new Date(),
): AttentionLine | null {
  const cash = buildFinancialPosition(data).totalCashAssets

  // 1) Immediate: cash obligations due in the next 7 days exceed today's cash.
  const windowEnd = from.getTime() + SHORTFALL_WINDOW_DAYS * 86_400_000
  const dueSoon = upcomingItems.filter(
    (item) => item.settlement === 'cash' && item.cashImpactAmount > 0 && item.sortTime >= from.getTime() - 86_400_000 && item.sortTime <= windowEnd,
  )
  const dueSoonTotal = dueSoon.reduce((total, item) => total + item.cashImpactAmount, 0)
  if (dueSoon.length > 0 && greaterThanTL(dueSoonTotal, cash)) {
    const gap = diffTL(dueSoonTotal, cash)
    return {
      tone: 'danger',
      text: `Önümüzdeki ${SHORTFALL_WINDOW_DAYS} günde ${formatCurrency(dueSoonTotal)} ödeme var ama nakit ${formatCurrency(cash)} — ${formatCurrency(gap)} açık.`,
    }
  }

  const forecast = buildCashFlowForecast(data, { horizonMonths: FORECAST_HORIZON_MONTHS, from })

  // 2) Structural: a month in the projection goes negative.
  if (forecast.firstNegative) {
    return {
      tone: 'danger',
      text: `Nakit ${forecast.firstNegative.monthLabel} sonunda eksiye düşüyor (${formatCurrency(forecast.firstNegative.balance)}) — büyük ödemeleri öne/arkaya almayı düşün.`,
    }
  }

  // 3) Heads-up: balance stays positive but dips notably low.
  if (
    forecast.lowest &&
    forecast.startingBalance > 0 &&
    forecast.lowest.balance < forecast.startingBalance * LOW_BALANCE_RATIO
  ) {
    return {
      tone: 'warning',
      text: `Önümüzdeki ${FORECAST_HORIZON_MONTHS} ayın en düşük noktası ${forecast.lowest.monthLabel}: ${formatCurrency(forecast.lowest.balance)}.`,
    }
  }

  return null
}

/** Today's date key — exported so the dashboard can memo by day. */
export function attentionDayKey(from: Date = new Date()) {
  return dateInputValue(from)
}
