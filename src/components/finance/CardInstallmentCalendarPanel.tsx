import { CalendarRange } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '../ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../ui/card'
import { supabase } from '../../lib/supabase'
import type { Card, CardInstallment } from '../../types/database'
import { buildCardInstallmentCalendar } from '../../utils/cardInstallmentCalendar'
import { formatCurrency } from '../../utils/formatCurrency'

type CardInstallmentCalendarPanelProps = {
  cards: Card[]
}

export function CardInstallmentCalendarPanel({ cards }: CardInstallmentCalendarPanelProps) {
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
    const { data, error } = await supabase.from('card_installments').select('*').order('due_month', { ascending: true })

    if (error) {
      setInstallments([])
    } else {
      setInstallments(((data ?? []) as CardInstallment[]).filter((item) => creditCardIds.has(item.card_id)))
    }
    setLoading(false)
  }, [creditCards.length])

  useEffect(() => {
    void loadInstallments()
  }, [loadInstallments])

  const months = useMemo(() => buildCardInstallmentCalendar(installments, creditCards, 4), [creditCards, installments])
  const hasAny = months.some((month) => month.total > 0)

  if (creditCards.length === 0) return null

  return (
    <SurfaceCard id="taksit-takvimi" className="border-0 shadow-sm ring-1 ring-indigo-200/80 dark:ring-indigo-900/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange size={17} />
              Taksit takvimi
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Önümüzdeki 4 ayda kartlara yansıyacak taksit yükü.</p>
          </div>
          <Badge variant="secondary">{creditCards.length} kart</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
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
                  <span className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs font-bold tabular-nums dark:bg-stone-900">
                    {formatCurrency(month.total)}
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
                          {formatCurrency(row.amount)}
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
