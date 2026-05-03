type StatCardProps = {
  label: string
  value: string
  tone?: 'default' | 'good' | 'bad'
}

export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'bad'
        ? 'text-rose-700 dark:text-rose-400'
        : 'text-stone-950 dark:text-stone-50'

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <p className="text-xs font-medium uppercase tracking-normal text-stone-500 dark:text-stone-400">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}
