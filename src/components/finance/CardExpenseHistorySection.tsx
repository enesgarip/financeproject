import { useMemo } from 'react'
import type { ExpenseMatchRow } from '../../data/repositories/cardsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { sumTL } from '../../utils/money'

type Props = {
  expenses: ExpenseMatchRow[]
  periodLabel: string
}

function formatShortDate(iso: string) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso.slice(0, 10)}T00:00:00`))
}

function statusLabel(status: string) {
  if (status === 'provision') return 'Provizyon'
  if (status === 'posted') return 'Dönem içi'
  if (status === 'cancelled') return 'İptal'
  return status
}

function statusClassName(status: string) {
  if (status === 'provision') return 'bg-warning/10 text-warning'
  if (status === 'cancelled') return 'bg-destructive/10 text-destructive'
  return 'bg-success/10 text-success'
}

export function CardExpenseHistorySection({ expenses, periodLabel }: Props) {
  const { formatAmount } = useBalancePrivacy()
  const { activeTotal, sortedExpenses } = useMemo(() => {
    const sorted = [...expenses].sort((left, right) => right.spent_at.localeCompare(left.spent_at))
    const active = sorted.filter((expense) => expense.status !== 'cancelled')
    return {
      activeTotal: sumTL(active.map((expense) => expense.amount)),
      sortedExpenses: sorted,
    }
  }, [expenses])

  return (
    <div className="border-b border-border">
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground">App dönem harcamaları</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{periodLabel || 'Dönem belirlenemedi'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-black text-foreground">{formatAmount(activeTotal)}</p>
            <p className="text-[10px] font-bold text-muted-foreground">{expenses.length} kayıt</p>
          </div>
        </div>

        {sortedExpenses.length === 0 ? (
          <p className="rounded-lg bg-muted/35 p-2.5 text-[11px] font-medium text-muted-foreground">
            Bu dönem için app'te harcama kaydı yok.
          </p>
        ) : (
          <div className="max-h-52 overflow-y-auto rounded-lg border border-border/60">
            {sortedExpenses.map((expense) => (
              <div
                key={expense.id}
                className="flex items-start justify-between gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className={`min-w-0 truncate text-xs font-bold ${expense.status === 'cancelled' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      {expense.description || 'Açıklama yok'}
                    </p>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${statusClassName(expense.status)}`}>
                      {statusLabel(expense.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatShortDate(expense.spent_at)} · {expense.category || 'Kategori yok'}
                    {expense.installment_count > 1 ? ` · ${expense.installment_count} taksit` : ''}
                  </p>
                </div>
                <span className={`shrink-0 text-right text-xs font-black ${expense.status === 'cancelled' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {formatAmount(expense.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
