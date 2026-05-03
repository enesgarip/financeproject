export function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

export function nextMonthlyDate(day: number | null | undefined) {
  if (!day) return null
  const today = new Date()
  const target = new Date(today.getFullYear(), today.getMonth(), day)
  if (target < startOfToday()) {
    target.setMonth(target.getMonth() + 1)
  }
  return target
}

export function daysUntil(value: Date | string | null | undefined) {
  if (!value) return null
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  const ms = date.getTime() - startOfToday().getTime()
  return Math.ceil(ms / 86_400_000)
}

export function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export function isUpcomingDate(value: string | null | undefined, days = 30) {
  const remaining = daysUntil(value)
  return remaining !== null && remaining >= 0 && remaining <= days
}
