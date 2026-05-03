type StatCardProps = {
  label: string
  value: string
  tone?: 'default' | 'good' | 'bad'
}

export function StatCard({ label, value, tone = 'default' }: StatCardProps) {
  const toneClass =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-stone-950'

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-normal text-stone-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  )
}
