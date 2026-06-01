import { CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import type { Card as FinanceCard } from '../../types/database'
import {
  buildStatementReminders,
  statementReminderDescription,
  statementReminderTitle,
} from '../../utils/statementReminder'
import { dateInputValue, formatDate } from '../../utils/date'

type StatementReminderPanelProps = {
  cards: FinanceCard[]
}

const statementReminderHelp = {
  calculation: 'Ekstre günü ve son ödeme günü olan kredi kartlarında yaklaşan veya kesilebilir ekstreler hesaplanır.',
  importance: 'Ekstre kesimini ve son ödeme tarihini kaçırmadan takip etmeyi kolaylaştırır.',
  source: 'Kartlar ekranındaki kredi kartı ekstre günü, son ödeme günü ve borç bilgileri.',
} satisfies HelpTooltipContent

export function StatementReminderPanel({ cards }: StatementReminderPanelProps) {
  const reminders = buildStatementReminders(cards)

  if (reminders.length === 0) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-info/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock size={17} />
              Ekstre hatırlatıcısı
              <HelpTooltip title="Ekstre hatırlatıcısı" content={statementReminderHelp} />
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Kesilecek veya yaklaşan ekstreler.</p>
          </div>
          <Badge variant="secondary">{reminders.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {reminders.map((reminder) => (
          <div
            key={`${reminder.cardId}-${reminder.kind}`}
            className={`rounded-lg px-3 py-2.5 text-sm ${
              reminder.kind === 'ready' ? 'bg-info/10' : 'bg-warning/10'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-foreground">{statementReminderTitle(reminder)}</p>
                  <Badge variant={reminder.kind === 'ready' ? 'default' : 'secondary'}>
                    {reminder.kind === 'ready' ? 'Kesilebilir' : `${reminder.daysUntilStatement} gün`}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{statementReminderDescription(reminder)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ekstre: {formatDate(dateInputValue(reminder.statementDate))}
                  {reminder.dueDay ? ` · Son ödeme: ${reminder.dueDateLabel}` : ''}
                </p>
              </div>
              <Link
                to="/kartlar"
                className="shrink-0 rounded-lg bg-card px-2.5 py-1.5 text-xs font-semibold text-info ring-1 ring-info/20 transition hover:bg-info/10"
              >
                Kartlara git
              </Link>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
