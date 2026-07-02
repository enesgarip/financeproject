import { PieChart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { Progress } from '../ui/progress'
import type { Budget, CardExpense } from '../../types/database'
import { buildBudgetAlerts } from '../../utils/budgetAlerts'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { diffTL } from '../../utils/money'

type BudgetAlertPanelProps = {
  budgets: Budget[]
  expenses: CardExpense[]
}

const budgetAlertHelp = {
  calculation: 'Bu ayki kategori bütçesi, iptal edilmemiş kart harcamalarıyla karşılaştırılır; %80 üzeri uyarı, limit aşımı kırmızı görünür.',
  importance: 'Ay bitmeden hangi kategorinin kontrolden çıktığını erken yakalamaya yardım eder.',
  source: 'Analiz ekranındaki bütçeler ve kart harcama kayıtları.',
} satisfies HelpTooltipContent

export function BudgetAlertPanel({ budgets, expenses }: BudgetAlertPanelProps) {
  const { formatAmount } = useBalancePrivacy()
  const alerts = buildBudgetAlerts(budgets, expenses)

  if (alerts.length === 0) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-warning/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart size={17} />
              Bütçe uyarıları
              <HelpTooltip title="Bütçe uyarıları" content={budgetAlertHelp} />
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Bu ay limitine yaklaşan veya aşan kategoriler.</p>
          </div>
          <Badge variant="secondary">{alerts.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {alerts.map((alert) => {
          const progressValue = Math.min(100, alert.usageRate)

          return (
            <div
              key={alert.budgetId}
              className={`rounded-lg px-3 py-2.5 ${alert.status === 'over' ? 'bg-destructive/10' : 'bg-warning/10'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{alert.category}</p>
                    <Badge variant={alert.status === 'over' ? 'destructive' : 'secondary'}>
                      {alert.status === 'over' ? 'Limit aşıldı' : `%${Math.round(progressValue)}`}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatAmount(alert.spent)} / {formatAmount(alert.limit)}
                    {alert.status === 'over'
                      ? ` · ${formatAmount(diffTL(alert.spent, alert.limit))} fazla`
                      : ` · kalan ${formatAmount(alert.remaining)}`}
                  </p>
                </div>
                <Link
                  to="/analiz"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-card px-3 py-1.5 text-xs font-semibold text-warning ring-1 ring-warning/20 transition hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                >
                  Analiz
                </Link>
              </div>
              <Progress value={progressValue} className="mt-2 h-1.5" aria-label={`${alert.category} bütçe kullanımı %${Math.round(progressValue)}`} />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
