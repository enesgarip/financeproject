import type { CreditScoreHistory } from '../types/database'

export type CreditScoreSummary = {
  current: CreditScoreHistory | null
  previous: CreditScoreHistory | null
  change: number | null
  trend: number[]
}

/** Findeks kayıtlarını kronolojik sıralar ve son iki ölçümü karşılaştırır. */
export function buildCreditScoreSummary(rows: CreditScoreHistory[], trendLimit = 12): CreditScoreSummary {
  const ordered = [...rows].sort((a, b) =>
    a.checked_on.localeCompare(b.checked_on) || a.created_at.localeCompare(b.created_at),
  )
  const current = ordered.at(-1) ?? null
  const previous = ordered.at(-2) ?? null

  return {
    current,
    previous,
    change: current && previous ? current.score - previous.score : null,
    trend: ordered.slice(-trendLimit).map((row) => row.score),
  }
}
