/** Küçük etiket/değer kutusu — analiz panellerinde paylaşılır. */
export function StatPill({ label, value, tone = 'stone' }: { label: string; value: string; tone?: 'emerald' | 'rose' | 'stone' }) {
  const toneClass = {
    emerald: 'text-success',
    rose: 'text-destructive',
    stone: 'text-foreground',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl bg-muted/55 px-3 py-2">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-[clamp(0.76rem,3.2vw,1rem)] font-extrabold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
