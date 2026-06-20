import {
  CalendarClock,
  CreditCard as CreditCardIcon,
  LayoutGrid,
  ReceiptText,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cutDueCardStatements } from '../data/repositories/cardsRepo'
import type { Card, CardStatementArchive } from '../types/database'
import { cn } from '../lib/utils'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { shouldRunStatementCut } from './CardsPage.helpers'


export type CardSection = 'ozet' | 'kartlar' | 'islemler' | 'ekstreler'

const cardSections = [
  { id: 'ozet', label: 'Özet', icon: LayoutGrid },
  { id: 'kartlar', label: 'Kartlar', icon: CreditCardIcon },
  { id: 'islemler', label: 'İşlemler', icon: ReceiptText },
  { id: 'ekstreler', label: 'Ekstreler', icon: CalendarClock },
] as const satisfies readonly { id: CardSection; label: string; icon: typeof LayoutGrid }[]

export function CardSectionNav({
  section,
  onSelect,
  counts,
}: {
  section: CardSection
  onSelect: (next: CardSection) => void
  counts: Partial<Record<CardSection, number>>
}) {
  return (
    <div className="finance-command-surface -mx-1 flex gap-1.5 overflow-x-auto rounded-lg p-1.5 finance-scrollbar">
      {cardSections.map((item) => {
        const isActive = item.id === section
        const count = counts[item.id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-pressed={isActive}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1.5 py-2 text-[11px] font-black leading-tight transition',
              'min-[560px]:flex-row min-[560px]:gap-1.5 min-[560px]:px-3 min-[560px]:text-xs',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            <item.icon size={16} strokeWidth={2.3} className="shrink-0" />
            <span className="flex items-center gap-1 whitespace-nowrap">
              {item.label}
              {count ? (
                <span
                  className={cn(
                    'grid min-w-4 place-items-center rounded-full px-1 text-[9px] font-black tabular-nums min-[560px]:text-[10px]',
                    isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/12 text-primary',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function DueStatementAutomation({
  rows,
  statements,
  statementsLoading,
  reload,
  loadStatements,
  setError,
}: {
  rows: Card[]
  statements: CardStatementArchive[]
  statementsLoading: boolean
  reload: () => Promise<void>
  loadStatements: () => Promise<void>
  setError: (message: string) => void
}) {
  const activeRunKeyRef = useRef<string | null>(null)
  const completedRunKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (statementsLoading) return
    const dueCards = rows.filter((card) => shouldRunStatementCut(card, statements))
    if (dueCards.length === 0) {
      if (!activeRunKeyRef.current) completedRunKeyRef.current = null
      return
    }

    const runKey = dueCards
      .map((card) => `${card.id}:${card.current_period_spending}:${card.statement_day ?? ''}:${card.due_day ?? ''}`)
      .sort()
      .join('|')
    if (activeRunKeyRef.current === runKey || completedRunKeyRef.current === runKey) return

    activeRunKeyRef.current = runKey

    let cancelled = false

    async function runDueStatementCut() {
      try {
        const cutResult = await cutDueCardStatements()

        if (!cutResult.ok) {
          setError(
            isMissingSupabaseCapabilityError(cutResult.error)
              ? missingSupabaseCapabilityMessage('Ekstre kesimi altyapısı', cutResult.error)
              : cutResult.error.message ?? 'Ekstre kesimi başarısız.',
          )
          return
        }

        if (!cancelled && cutResult.data > 0) {
          await Promise.all([reload(), loadStatements()])
        }
      } finally {
        if (activeRunKeyRef.current === runKey) {
          activeRunKeyRef.current = null
          completedRunKeyRef.current = runKey
        }
      }
    }

    void runDueStatementCut()

    return () => {
      cancelled = true
    }
  }, [loadStatements, reload, rows, setError, statements, statementsLoading])

  return null
}
