import { formatCurrency } from '../../utils/formatCurrency'

type InstallmentPlannerProps = {
  remainingCount: number
  totalInstallments: number
  remainingAmount: number
  firstLabel: string
  monthlyAmount?: number
  compact?: boolean
}

export function InstallmentPlanner({
  remainingCount,
  totalInstallments,
  remainingAmount,
  firstLabel,
  monthlyAmount,
  compact = false,
}: InstallmentPlannerProps) {
  return (
    <div className="rounded-xl border border-warning/20 bg-warning/8 p-3">
      <div className={`grid gap-2 text-xs ${compact ? 'grid-cols-3' : 'grid-cols-2 min-[460px]:grid-cols-4'}`}>
        <InstallmentStat label="Kalan" value={`${remainingCount}/${totalInstallments}`} />
        <InstallmentStat label="Toplam" value={formatCurrency(remainingAmount)} />
        <InstallmentStat label="İlk dönem" value={firstLabel} />
        {monthlyAmount !== undefined ? <InstallmentStat label="Aylık" value={formatCurrency(monthlyAmount)} /> : null}
      </div>
    </div>
  )
}

function InstallmentStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-card/60 px-2.5 py-2">
      <p className="truncate text-[11px] font-bold uppercase text-warning/80">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}
