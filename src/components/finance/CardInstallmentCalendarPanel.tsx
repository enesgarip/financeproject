import { CalendarRange } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../ui/help-tooltip'
import { fetchCardInstallments } from '../../data/repositories/cardsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card, CardInstallment } from '../../types/database'
import { buildCardInstallmentCalendar, buildCardInstallmentTotalsByCard } from '../../utils/cardInstallmentCalendar'

type CardInstallmentCalendarPanelProps = {
  cards: Card[]
}

const installmentCalendarHelp = {
  calculation: 'Ödenmemiş kart taksitleri vade ayına göre gruplanır ve önümüzdeki 4 ay için toplanır.',
  importance: 'Yaklaşan taksit yükünü aya göre önceden görmeni sağlar.',
  source: 'Kart taksit kayıtları ve bağlı kredi kartı bilgileri.',
} satisfies HelpTooltipContent

export function CardInstallmentCalendarPanel({ cards }: CardInstallmentCalendarPanelProps) {
  const { formatAmount } = useBalancePrivacy()
  const [installments, setInstallments] = useState<CardInstallment[]>([])
  const [loading, setLoading] = useState(true)

  const creditCards = useMemo(() => cards.filter((card) => card.card_type === 'kredi_karti'), [cards])

  const loadInstallments = useCallback(async () => {
    if (creditCards.length === 0) {
      setInstallments([])
      setLoading(false)
      return
    }

    setLoading(true)
    const creditCardIds = new Set(creditCards.map((card) => card.id))
    const result = await fetchCardInstallments()

    if (!result.ok) {
      setInstallments([])
    } else {
      setInstallments(result.data.filter((item) => creditCardIds.has(item.card_id)))
    }
    setLoading(false)
  }, [creditCards])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstallments()
  }, [loadInstallments])

  const months = useMemo(() => buildCardInstallmentCalendar(installments, creditCards, 4), [creditCards, installments])
  const cardTotals = useMemo(() => buildCardInstallmentTotalsByCard(installments, creditCards), [creditCards, installments])
  const hasAny = months.some((month) => month.total > 0)
  const hasOngoingInstallments = cardTotals.total > 0

  if (creditCards.length === 0) return null

  return (
    <SurfaceCard id="taksit-takvimi" className="border-primary/20 shadow-[var(--shadow-card)]">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange size={17} />
              Taksit takvimi
              <HelpTooltip title="Taksit takvimi" content={installmentCalendarHelp} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Önümüzdeki 4 ayda kartlara yansıyacak taksit yükü.</p>
          </div>
          <Badge variant="secondary">{creditCards.length} kart</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {!loading && hasOngoingInstallments ? (
          <section className="rounded-xl border border-border/70 bg-card/80 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-muted-foreground">Gelecek taksit toplamı</p>
                <p className="finance-value mt-1 text-xl font-black leading-none text-foreground">{formatAmount(cardTotals.total)}</p>
              </div>
              <Badge variant="warning">{cardTotals.rows.length} kart</Badge>
            </div>
            <div className="mt-3 grid gap-2 min-[640px]:grid-cols-2">
              {cardTotals.rows.map((row) => (
                <div key={row.cardId} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/45 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate font-semibold text-foreground">{row.cardLabel}</span>
                  <span className="shrink-0 text-right font-black tabular-nums text-foreground">
                    {formatAmount(row.amount)}
                    <span className="ml-1 font-semibold text-muted-foreground">
                      {row.count > 1 ? `· ${row.count} taksit` : '· 1 taksit'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Taksitler yükleniyor...</p>
        ) : !hasAny ? (
          <p className="rounded-xl bg-muted/45 p-3 text-sm text-muted-foreground">Bu dönem için planlı kart taksiti yok.</p>
        ) : (
          <div className="grid gap-3 min-[640px]:grid-cols-2">
            {months.map((month) => (
              <div key={month.monthKey} className="rounded-xl bg-muted/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-bold capitalize text-foreground">{month.monthLabel}</p>
                  <span className="shrink-0 rounded-lg bg-card px-2 py-1 font-mono text-xs font-bold tabular-nums text-foreground ring-1 ring-border/60">
                    {formatAmount(month.total)}
                  </span>
                </div>
                {month.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Taksit yok</p>
                ) : (
                  <ul className="space-y-1.5">
                    {month.rows.map((row) => (
                      <li key={`${month.monthKey}-${row.cardId}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-muted-foreground">{row.cardLabel}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-foreground">
                          {formatAmount(row.amount)}
                          {row.count > 1 ? ` · ${row.count} taksit` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </SurfaceCard>
  )
}
