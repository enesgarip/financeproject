import { Scale } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import type { Card as FinanceCard, CardStatementArchive } from '../../types/database'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import { formatDate } from '../../utils/date'
import { diffTL } from '../../utils/money'

type ReconciliationPanelProps = {
  cards: FinanceCard[]
  statements: CardStatementArchive[]
}

const reconciliationHelp = {
  calculation:
    'Kesilmiş her kredi kartı ekstresi için "bankanın bildirdiği tutar" ile app\'in hesapladığı ekstre borcu karşılaştırılır.',
  importance:
    'Aradaki fark, eksik girilmiş bir taksit/harcamayı ay sonunu beklemeden gösterir; mutabık olmayan ekstreler hatırlatılır.',
  source: 'Ekstre arşivi (kesilmiş ekstreler) ve ekstre içe aktarırken kaydedilen mutabakat tutarı.',
} satisfies HelpTooltipContent

const DELTA_THRESHOLD = 1

type ReconciliationItem = {
  statementId: string
  cardLabel: string
  statementDate: string
  kind: 'delta' | 'pending'
  delta: number
}

function buildItems(cards: FinanceCard[], statements: CardStatementArchive[]): ReconciliationItem[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const items: ReconciliationItem[] = []

  for (const statement of statements) {
    const card = cardsById.get(statement.card_id)
    const cardLabel = card ? `${card.bank_name} · ${card.card_name}` : 'Kart'

    if (statement.reconciled_at && statement.reconciled_bank_amount != null) {
      const delta = diffTL(statement.reconciled_bank_amount, statement.statement_debt_amount)
      if (Math.abs(delta) > DELTA_THRESHOLD) {
        items.push({ statementId: statement.id, cardLabel, statementDate: statement.statement_date, kind: 'delta', delta })
      }
      // delta ~0 → mutabık, gösterme
    } else {
      items.push({ statementId: statement.id, cardLabel, statementDate: statement.statement_date, kind: 'pending', delta: 0 })
    }
  }

  // Önce farklı olanlar (acil), sonra mutabakat bekleyenler
  return items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'delta' ? -1 : 1))
}

export function ReconciliationPanel({ cards, statements }: ReconciliationPanelProps) {
  const { formatAmount } = useBalancePrivacy()
  const items = buildItems(cards, statements)

  if (items.length === 0) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-warning/20">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale size={17} />
              Ekstre mutabakatı
              <HelpTooltip title="Ekstre mutabakatı" content={reconciliationHelp} />
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Banka ile uyuşmayan veya kontrol bekleyen ekstreler.</p>
          </div>
          <Badge variant="secondary">{items.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {items.map((item) => (
          <div
            key={item.statementId}
            className={`rounded-lg px-3 py-2.5 text-sm ${item.kind === 'delta' ? 'bg-destructive/10' : 'bg-info/10'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-foreground">{item.cardLabel}</p>
                  <Badge variant={item.kind === 'delta' ? 'destructive' : 'secondary'}>
                    {item.kind === 'delta'
                      ? `Fark ${item.delta >= 0 ? '+' : ''}${formatAmount(item.delta)}`
                      : 'Mutabakat bekliyor'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ekstre: {formatDate(item.statementDate)}
                  {item.kind === 'delta'
                    ? ' · Bankayla uyuşmuyor, eksik bir taksit/harcama olabilir.'
                    : ' · Ekstreyi içe aktarıp mutabık olarak kaydet.'}
                </p>
              </div>
              <Link
                to="/kartlar?section=ekstreler"
                className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-card px-3 py-1.5 text-xs font-semibold text-warning ring-1 ring-warning/20 transition hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
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
