import { CreditCard, Wallet } from 'lucide-react'
import { Link } from 'react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { Alert } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { fetchCards } from '../data/repositories/cardsRepo'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import type { Card as CardRow } from '../types/database'
import { getCardStatementPeriod } from '../utils/cardStatement'
import { dateInputValue, formatDate } from '../utils/date'
import { cardPayableDebt } from '../utils/financeSummary'
import { formatCurrency } from '../utils/formatCurrency'
import { sumTL } from '../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'

/**
 * Borçlar → Kart Borcu. Kredi kartı borcunu krediler/kişiler ile aynı "ne
 * borçluyum" bağlamında gösterir ve buradan ödetir. Kart ledger'ı/ekstre döngüsü
 * Hesaplar'da kalır — bu sayfa aynı veriyi OKUR (mükerrer yazma yok) ve ödemeyi
 * Hesaplar'daki ile birebir aynı paylaşılan drawer + pay_card_debt RPC'siyle yapar.
 */
export function LiabilitiesCardsPage() {
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()
  const invalidateSnapshot = useInvalidateFinanceSnapshot()

  const load = useCallback(async () => {
    const result = await fetchCards()
    if (!result.ok) {
      setError(result.error.message ?? 'Kartlar yüklenemedi.')
      setLoading(false)
      return
    }
    setCards(result.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const creditCards = useMemo(
    () => cards.filter((card) => card.card_type === 'kredi_karti'),
    [cards],
  )
  const cardsWithDebt = useMemo(
    () => creditCards.filter((card) => card.debt_amount > 0),
    [creditCards],
  )
  const totalDebt = useMemo(() => sumTL(creditCards.map((card) => card.debt_amount)), [creditCards])

  async function openDebtPayment(card: CardRow) {
    await openPaymentDrawer(
      {
        id: `card-debt-manual-${card.id}`,
        kind: 'card_debt',
        action: 'pay_card_debt',
        sourceId: card.id,
        relatedCardId: card.id,
        title: `${card.card_name} kart borcu`,
        subtitle: card.bank_name,
        date: dateInputValue(new Date()),
        amount: cardPayableDebt(card),
        direction: 'outflow',
      },
      {
        cards,
        reload: load,
        afterSuccess: async () => {
          await invalidateSnapshot()
        },
        detail: (
          <>
            <p className="font-semibold text-foreground">{card.card_name}</p>
            <p>Ekstre borcu: {formatCurrency(card.statement_debt_amount)}</p>
            <p>Dönem içi harcama: {formatCurrency(card.current_period_spending)}</p>
            <p>
              Ödenebilir toplam:{' '}
              <span className="font-mono font-semibold text-foreground">{formatCurrency(cardPayableDebt(card))}</span>
            </p>
          </>
        ),
        formatSubmitError: (submitError) =>
          isMissingSupabaseCapabilityError(submitError)
            ? missingSupabaseCapabilityMessage('Kart borcu ödeme altyapısı', submitError)
            : submitError.message ?? 'Kart borcu ödenemedi.',
      },
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert variant="warning">{error}</Alert> : null}

      <SurfaceCard>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toplam kart borcu</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(totalDebt)}</p>
          </div>
          <Badge variant="secondary">
            {cardsWithDebt.length} kart · {creditCards.length} kredi kartı
          </Badge>
        </CardContent>
      </SurfaceCard>

      {creditCards.length === 0 ? (
        <SurfaceCard>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Kredi kartın yok. Kart eklemek ve yönetmek için{' '}
            <Link to="/kartlar" className="font-semibold text-primary hover:underline">
              Hesaplar
            </Link>{' '}
            sayfasına git.
          </CardContent>
        </SurfaceCard>
      ) : cardsWithDebt.length === 0 ? (
        <SurfaceCard>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Kredi kartlarında borç yok. 🎉
          </CardContent>
        </SurfaceCard>
      ) : (
        cardsWithDebt.map((card) => {
          const period = getCardStatementPeriod(card, new Date())
          const payable = cardPayableDebt(card)
          return (
            <SurfaceCard key={card.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CreditCard className="size-4 text-primary" /> {card.card_name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{card.bank_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums text-foreground">{formatCurrency(card.debt_amount)}</p>
                    <p className="text-xs text-muted-foreground">Toplam borç</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <DebtStat label="Ekstre borcu" value={formatCurrency(card.statement_debt_amount)} />
                  <DebtStat label="Dönem içi" value={formatCurrency(card.current_period_spending)} />
                  <DebtStat label="Ödenebilir" value={formatCurrency(payable)} />
                  <DebtStat
                    label="Son ödeme"
                    value={period ? formatDate(period.dueDate) : 'Gün eksik'}
                  />
                </div>
                <Button
                  variant="default"
                  className="w-full sm:w-auto sm:self-end"
                  disabled={payable <= 0}
                  onClick={() => void openDebtPayment(card)}
                >
                  <Wallet /> Kart borcunu öde
                </Button>
              </CardContent>
            </SurfaceCard>
          )
        })
      )}

      <FinancePaymentDrawer {...drawerProps} />
    </div>
  )
}

function DebtStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
      <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}
