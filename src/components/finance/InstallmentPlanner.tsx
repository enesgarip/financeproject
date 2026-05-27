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
    <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/25">
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
    <div className="min-w-0 rounded-lg bg-white/70 px-2.5 py-2 dark:bg-stone-950/35">
      <p className="truncate text-[11px] font-bold uppercase text-amber-800/70 dark:text-amber-200/70">{label}</p>
      <p className="mt-1 truncate text-sm font-black tabular-nums text-stone-950 dark:text-stone-50">{value}</p>
    </div>
  )
}
