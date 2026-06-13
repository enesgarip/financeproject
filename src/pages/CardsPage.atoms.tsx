import { HelpTooltip, type HelpTooltipContent } from '../components/ui/help-tooltip'

/** Küçük etiket/değer kutusu — kart özet panellerinde paylaşılır. */
export function OverviewStat({ label, value, help }: { label: string; value: string; help?: HelpTooltipContent }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1">
        <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
        {help ? <HelpTooltip title={label} content={help} /> : null}
      </div>
      <p className="mt-1 truncate text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

/** Tonlu etiket/değer kutusu — kart/hesap detay kartlarında paylaşılır. */
export function CardDatum({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'warning' | 'danger' }) {
  const valueClass = {
    neutral: 'text-foreground',
    good: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
  }[tone]

  return (
    <div className="finance-field min-w-0 rounded-lg px-3 py-2.5">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`finance-value mt-1 truncate text-sm font-black leading-tight ${valueClass}`}>{value}</p>
    </div>
  )
}
