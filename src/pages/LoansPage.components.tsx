import { CalendarDays, Landmark } from 'lucide-react'
import { BankLogo } from '../components/finance/BankLogo'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import type { Loan, LoanInstallment } from '../types/database'
import { formatDate } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { sumTL } from '../utils/money'
import { loanProgress, nextPendingInstallment } from './LoansPage.helpers'

export function LoanOverview({ loans, installments }: { loans: Loan[]; installments: LoanInstallment[] }) {
  const activeLoans = loans.filter((loan) => loan.status === 'active')
  if (activeLoans.length === 0) return null

  const totalRemaining = sumTL(activeLoans.map((loan) => loan.remaining_amount))
  const totalMonthly = sumTL(activeLoans.map((loan) => loan.monthly_payment))
  const nextItems = activeLoans
    .map((loan) => ({ loan, item: nextPendingInstallment(loan, installments) }))
    .filter((entry): entry is { loan: Loan; item: LoanInstallment } => Boolean(entry.item))
    .sort((a, b) => a.item.due_date.localeCompare(b.item.due_date))
  const nextPayment = nextItems[0]

  return (
    <div className="flex flex-col gap-3">
      <SurfaceCard variant="elevated" className="overflow-hidden">
        <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-destructive via-primary to-info opacity-80" />
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="finance-label">Aylık Ödeme Yükü</p>
              <p className="finance-value mt-1.5 text-[clamp(1.5rem,6vw,2.1rem)] font-bold leading-none text-foreground">{formatCurrency(totalMonthly)}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">Aktif kredilerin toplam taksiti</p>
            </div>
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/12 text-destructive">
              <Landmark className="size-5" />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <OverviewStat label="Kalan Borç" value={formatCurrency(totalRemaining)} tone="danger" />
            <OverviewStat label="Aktif Kredi" value={`${activeLoans.length} kayıt`} />
          </div>
          {nextPayment ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{nextPayment.loan.loan_name}</p>
                <p className="text-xs text-muted-foreground">Sıradaki taksit · {formatDate(nextPayment.item.due_date)}</p>
              </div>
              <Badge variant="warning">{formatCurrency(nextPayment.item.amount)}</Badge>
            </div>
          ) : null}
        </CardContent>
      </SurfaceCard>

      <div className="grid gap-3 min-[680px]:grid-cols-2 xl:grid-cols-3">
        {activeLoans.map((loan) => {
          const progress = loanProgress(loan, installments)
          return (
            <SurfaceCard key={loan.id} variant="interactive">
              <CardHeader className="pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <BankLogo bankName={loan.bank_name} size="sm" />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{loan.loan_name}</CardTitle>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{loan.bank_name}</p>
                    </div>
                  </div>
                  <Badge variant={progress.next ? 'warning' : 'success'}>
                    {progress.totalCount ? `${progress.paidCount}/${progress.totalCount}` : `${loan.remaining_installments} kaldı`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-1">
                <Progress value={progress.progressRate} color="primary" size="default" />
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <OverviewStat label="Kalan Borç" value={formatCurrency(loan.remaining_amount)} tone="danger" />
                  <OverviewStat label="Taksit" value={formatCurrency(loan.monthly_payment)} />
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays size={14} />
                  {progress.next ? formatDate(progress.next.due_date) : 'Bekleyen taksit yok'}
                </div>
              </CardContent>
            </SurfaceCard>
          )
        })}
      </div>
    </div>
  )
}

export function OverviewStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' | 'success' }) {
  const toneClass = tone === 'danger' ? 'text-destructive' : tone === 'success' ? 'text-success' : 'text-foreground'
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
      <p className="finance-label truncate">{label}</p>
      <p className={`finance-value mt-1 truncate text-sm font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
