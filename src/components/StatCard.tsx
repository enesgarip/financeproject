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
    <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900 min-[390px]:p-4">
      <p className="truncate text-[11px] font-semibold uppercase leading-tight tracking-normal text-stone-500 dark:text-stone-400">{label}</p>
      <p className={`mt-2 break-words text-[clamp(1rem,4.8vw,1.25rem)] font-semibold leading-tight tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
