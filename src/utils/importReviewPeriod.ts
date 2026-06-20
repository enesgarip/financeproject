export type ImportReviewPeriod = {
  start: string
  end: string
  label: string
}

function formatShortDate(iso: string) {
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00`))
}

export function reviewPeriodLabel(start: string, end: string) {
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} - ${formatShortDate(end)}`
}

export function dateRangeFromIsoDates(values: string[]): ImportReviewPeriod | null {
  const dates = values
    .map((value) => value.slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()

  if (!dates.length) return null

  const start = dates[0]
  const end = dates[dates.length - 1]
  return { start, end, label: reviewPeriodLabel(start, end) }
}

export function rowsInReviewPeriod<T extends { spent_at: string }>(
  rows: T[],
  period: Pick<ImportReviewPeriod, 'start' | 'end'> | null,
): T[] {
  if (!period) return []
  return rows.filter((row) => {
    const date = row.spent_at.slice(0, 10)
    return date >= period.start && date <= period.end
  })
}
