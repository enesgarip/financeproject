import { PieChart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Progress } from '../ui/progress'
import type { Budget, CardExpense } from '../../types/database'
import { buildBudgetAlerts } from '../../utils/budgetAlerts'
import { formatCurrency } from '../../utils/formatCurrency'

type BudgetAlertPanelProps = {
  budgets: Budget[]
  expenses: CardExpense[]
}

export function BudgetAlertPanel({ budgets, expenses }: BudgetAlertPanelProps) {
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
                    {formatCurrency(alert.spent)} / {formatCurrency(alert.limit)}
                    {alert.status === 'over'
                      ? ` · ${formatCurrency(alert.spent - alert.limit)} fazla`
                      : ` · kalan ${formatCurrency(alert.remaining)}`}
                  </p>
                </div>
                <Link
                  to="/analiz"
                  className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-xs font-semibold text-warning ring-1 ring-warning/20 transition hover:bg-warning/10"
                >
                  Analiz
                </Link>
              </div>
              <Progress value={progressValue} className="mt-2 h-1.5" />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
