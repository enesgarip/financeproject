import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from 'lucide-react'
import { CrudPage, type FormField } from '../components/CrudPage'
import { Card, CardContent } from '../components/ui/card'
import type { SalaryHistory } from '../types/database'
import { formatDate } from '../utils/date'
import { parseNumber } from '../utils/formatCurrency'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { getSalaryTrend } from '../utils/financeSummary'
import { diffTL } from '../utils/money'

const salaryFields: FormField[] = [
  { name: 'title', label: 'Başlık', type: 'text', required: true },
  { name: 'amount', label: 'Net maaş', type: 'number', min: '0', step: '0.01', required: true },
  { name: 'effective_date', label: 'Geçerli olduğu tarih', type: 'date', required: true },
  { name: 'note', label: 'Not', type: 'textarea' },
]

function SalaryOverview({ rows }: { rows: SalaryHistory[] }) {
  const { formatAmount } = useBalancePrivacy()
  if (rows.length === 0) return null

  const { current, previous, difference, percentage } = getSalaryTrend(rows)
  if (!current) return null
  const isUp = difference > 0
  const isDown = difference < 0
  const DeltaIcon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus
  const deltaColor = isUp ? 'text-success' : isDown ? 'text-destructive' : 'text-muted-foreground'

  return (
    <Card variant="default" className="overflow-hidden border-success/20">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="finance-label">Güncel Maaş</p>
            <p className="finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none text-foreground">
              {formatAmount(current.amount)}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{formatDate(current.effective_date)}</p>
          </div>
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
            <TrendingUp className="size-5" />
          </div>
        </div>

        {previous ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">Önceki kayda göre</span>
            <span className={`flex items-center gap-1 font-mono text-sm font-semibold tabular-nums ${deltaColor}`}>
              <DeltaIcon size={14} />
              {difference >= 0 ? '+' : ''}{formatAmount(difference)}
              <span className="ml-1 text-xs">({percentage >= 0 ? '+' : ''}{percentage.toFixed(1)}%)</span>
            </span>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
            İlk maaş kaydı — sonraki kayıtlarda artış trendi burada görünecek.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SalaryPage() {
  const { formatAmount } = useBalancePrivacy()
  return (
    <CrudPage
      table="salary_history"
      pageTitle="Maaş geçmişi"
      addLabel="Maaş ekle"
      fields={salaryFields}
      emptyTitle="Henüz maaş kaydı yok"
      emptyDescription="Maaşını varlık hesaplarına katmadan tarihsel artışını buradan takip edebilirsin."
      orderBy="effective_date"
      orderAscending={false}
      renderBeforeList={({ loading, rows }) => (!loading ? <SalaryOverview rows={rows as SalaryHistory[]} /> : null)}
      getInitialValues={(row?: SalaryHistory) => ({
        title: row?.title ?? 'Maaş',
        amount: row?.amount ?? 0,
        effective_date: row?.effective_date ?? new Date().toLocaleDateString('sv-SE'),
        note: row?.note ?? '',
      })}
      mapForm={(formData, userId) => ({
        user_id: userId,
        title: String(formData.get('title') ?? '').trim() || 'Maaş',
        amount: parseNumber(formData.get('amount')),
        effective_date: String(formData.get('effective_date') ?? ''),
        note: String(formData.get('note') ?? '') || null,
      })}
      renderTitle={(row) => row.title}
      renderSubtitle={(row) => formatDate(row.effective_date)}
      renderDetails={(row) => [`Net maaş: ${formatAmount(row.amount)}`]}
      renderExtra={(row, helpers) => {
        const orderedRows = [...(helpers.rows as SalaryHistory[])].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
        const index = orderedRows.findIndex((item) => item.id === row.id)
        const previous = index > 0 ? orderedRows[index - 1] : null
        if (!previous || previous.amount <= 0) return null

        const difference = diffTL(row.amount, previous.amount)
        const percentage = (difference / previous.amount) * 100
        const isUp = difference >= 0
        return (
          <div className={`mt-3 flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${isUp ? 'border-success/20 bg-success/8 text-success' : 'border-destructive/20 bg-destructive/8 text-destructive'}`}>
            {isUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            <span className="font-mono font-semibold tabular-nums">
              {difference >= 0 ? '+' : ''}{formatAmount(difference)} ({percentage >= 0 ? '+' : ''}{percentage.toFixed(1)}%)
            </span>
          </div>
        )
      }}
      getCardClassName={() => 'border-success/20 bg-success/5 dark:bg-success/8'}
      getDetailClassName={() => 'bg-muted/40'}
    />
  )
}
