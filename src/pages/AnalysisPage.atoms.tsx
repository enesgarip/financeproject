/** Küçük etiket/değer kutusu — analiz panellerinde paylaşılır. */
export function StatPill({ label, value, tone = 'stone' }: { label: string; value: string; tone?: 'emerald' | 'rose' | 'stone' }) {
  const toneClass = {
    emerald: 'text-success',
    rose: 'text-destructive',
    stone: 'text-ink',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl bg-page px-3 py-2">
      <p title={label} className="truncate text-[11px] font-bold uppercase text-ink-muted">{label}</p>
      <p title={value} className={`mt-1 block max-w-full truncate whitespace-nowrap text-[clamp(0.76rem,3.2vw,1rem)] font-extrabold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
