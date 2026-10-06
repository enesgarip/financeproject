import type { CreditScoreHistory } from '../types/database'

export type CreditScoreSummary = {
  current: CreditScoreHistory | null
  previous: CreditScoreHistory | null
  change: number | null
  trend: number[]
}

export type CreditScoreCheckStatus = {
  daysSinceCheck: number | null
  due: boolean
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

/** Ayda bir kontrol ritmi: son sorgudan 30 takvim günü geçince tekrar hatırlat. */
export function creditScoreCheckStatus(
  latest: CreditScoreHistory | null,
  today: string,
  intervalDays = 30,
): CreditScoreCheckStatus {
  if (!latest) return { daysSinceCheck: null, due: true }

  const toUtcDay = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  const daysSinceCheck = Math.max(0, Math.floor((toUtcDay(today) - toUtcDay(latest.checked_on)) / 86_400_000))
  return { daysSinceCheck, due: daysSinceCheck >= intervalDays }
}
