import {
  CreditCard as CreditCardIcon,
  WalletCards,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { cutDueCardStatements } from '../data/repositories/cardsRepo'
import type { Card, CardStatementArchive } from '../types/database'
import { cn } from '../lib/utils'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { shouldRunStatementCut } from './CardsPage.helpers'


export type CardSection = 'ozet' | 'kartlar' | 'hesaplar' | 'islemler' | 'ekstreler'

const cardSections = [
  { id: 'hesaplar', label: 'Hesaplar ve nakit', icon: WalletCards },
  { id: 'kartlar', label: 'Kredi kartları', icon: CreditCardIcon },
] as const

export function CardSectionNav({ section, onSelect, counts }: {
  section: CardSection
  onSelect: (next: CardSection) => void
  counts: Partial<Record<CardSection, number>>
}) {
  return (
    <nav className="grid grid-cols-2 gap-3" aria-label="Hesap veya kart seçimi">
      {cardSections.map((item) => (
        <button key={item.id} type="button" onClick={() => onSelect(item.id)} aria-pressed={section === item.id}
          className={cn('min-h-24 rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:p-4', section === item.id ? 'border-primary bg-primary/10' : 'border-line-strong bg-raised hover:border-primary/50')}>
          <item.icon size={21} className="mb-2 text-primary" aria-hidden="true" />
          <span className="block text-sm font-semibold text-ink">{item.label} <span className="text-ink-muted">{counts[item.id] ?? 0}</span></span>
          <span className="mt-1 block text-xs text-ink-muted">{item.id === 'kartlar' ? 'Dönem içi borç ve gelecek taksitler' : 'Bakiyeler ve hesap hareketleri'}</span>
        </button>
      ))}
    </nav>
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
      // BAŞARIDA damgala, hatada damgalama: `finally` içinde damgalanınca geçici
      // bir ağ/RPC hatası dönemi "tamamlandı" sayıyor ve ekstre kesimi o oturum
      // boyunca bir daha denenmiyordu. Kullanıcıya görünen hata korunur.
      let succeeded = false
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

        succeeded = true
        if (!cancelled && cutResult.data > 0) {
          await Promise.all([reload(), loadStatements()])
        }
      } finally {
        if (activeRunKeyRef.current === runKey) {
          activeRunKeyRef.current = null
          if (succeeded) completedRunKeyRef.current = runKey
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
