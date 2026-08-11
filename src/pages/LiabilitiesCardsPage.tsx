import { Link } from 'react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { Alert } from '../components/ui/alert'
import { BreakdownBar, HeroNumber, LineGroup, SectionEyebrow, SERIT_TEXT, useSeritAmount } from '../components/serit'
import { Skeleton } from '../components/ui/skeleton'
import { fetchCards, fetchOpenStatementArchives } from '../data/repositories/cardsRepo'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import type { Card as CardRow, CardStatementArchive } from '../types/database'
import { getCardStatementPeriod } from '../utils/cardStatement'
import { dateInputValue, formatDate } from '../utils/date'
import { cardPayableDebt, totalCreditLimit } from '../utils/financeSummary'
import { formatPercent } from '../utils/formatCurrency'
import { sumTL } from '../utils/money'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'

/**
 * Borçlar → Kart Borcu. Kredi kartı borcunu krediler/kişiler ile aynı "ne
 * borçluyum" bağlamında gösterir ve buradan ödetir. Kart ledger'ı/ekstre döngüsü
 * Hesaplar'da kalır — bu sayfa aynı veriyi OKUR (mükerrer yazma yok) ve ödemeyi
 * Hesaplar'daki ile birebir aynı paylaşılan drawer + RPC'lerle yapar: açık
 * ekstresi olan kartta pay_card_statement (kanonik yol; pay_card_debt arşivi
 * kapatmadan kovayı düşürürdü), diğerlerinde pay_card_debt.
 */
export function LiabilitiesCardsPage() {
  const [cards, setCards] = useState<CardRow[]>([])
  const [openStatements, setOpenStatements] = useState<CardStatementArchive[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const seritAmount = useSeritAmount()

  const load = useCallback(async () => {
    const [cardsResult, statementsResult] = await Promise.all([fetchCards(), fetchOpenStatementArchives()])
    if (!cardsResult.ok) {
      setError(cardsResult.error.message ?? 'Kartlar yüklenemedi.')
      setLoading(false)
      return
    }
    if (!statementsResult.ok) {
      setError(statementsResult.error.message ?? 'Açık ekstreler yüklenemedi.')
      setLoading(false)
      return
    }
    setCards(cardsResult.data)
    setOpenStatements(statementsResult.data)
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

  // Açık ekstresi olan kartta kanonik yol pay_card_statement'tır: pay_card_debt
  // arşivi kapatmadan statement kovasını düşürür (Veri Sağlığı mismatch + ekstre
  // ikinci kez ödenebilir kalır). Hesaplar'daki openStatementPayment ile aynı desen.
  async function openStatementPayment(statement: CardStatementArchive, card: CardRow) {
    await openPaymentDrawer(
      {
        id: `card-statement-${statement.id}`,
        kind: 'card_statement',
        action: 'pay_card_statement',
        sourceId: statement.id,
        relatedCardId: card.id,
        title: `${card.card_name} ekstresi`,
        subtitle: card.bank_name,
        date: statement.due_date ?? statement.statement_date,
        amount: statement.statement_debt_amount,
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
            <p>Son ödeme: {formatDate(statement.due_date)}</p>
            <p>
              Ekstre tutarı:{' '}
              <span className="font-mono font-semibold text-foreground">{seritAmount(statement.statement_debt_amount).amount} ₺</span>
            </p>
          </>
        ),
        formatSubmitError: (submitError) =>
          isMissingSupabaseCapabilityError(submitError)
            ? missingSupabaseCapabilityMessage('Ekstre ödeme altyapısı', submitError)
            : submitError.message ?? 'Ekstre ödenemedi.',
      },
    )
  }

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
        minimumPaymentBase: card.statement_debt_amount,
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
            <p>Ekstre borcu: {seritAmount(card.statement_debt_amount).amount} ₺</p>
            <p>Dönem içi harcama: {seritAmount(card.current_period_spending).amount} ₺</p>
            <p>
              Ödenebilir toplam:{' '}
              <span className="font-mono font-semibold text-foreground">{seritAmount(cardPayableDebt(card)).amount} ₺</span>
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

  // Şerit (`3a`): kahraman = toplam kart borcu + kova çubuğu + limit kullanımı.
  const buckets = {
    statement: sumTL(creditCards.map((card) => card.statement_debt_amount)),
    current: sumTL(creditCards.map((card) => card.current_period_spending)),
    provision: sumTL(creditCards.map((card) => card.provision_amount ?? 0)),
  }
  // Ortak limit grubunda kart başına toplama çift sayar; grup başına max (K12).
  const totalLimit = totalCreditLimit(creditCards)
  const usageRate = totalLimit > 0 ? Math.min(100, (totalDebt / totalLimit) * 100) : 0
  // Ödenecek ekstre: en erken vadeli açık ekstre (fetch zaten due_date artan sıralı).
  const dueStatement = openStatements.find((statement) => statement.statement_debt_amount > 0)
  const dueStatementCard = dueStatement ? creditCards.find((card) => card.id === dueStatement.card_id) : undefined

  return (
    <div>
      {error ? <Alert variant="warning">{error}</Alert> : null}

      <HeroNumber
        label="Toplam kart borcu"
        value={totalDebt}
        description={
          totalLimit > 0 ? (
            <>
              {cardsWithDebt.length} kartta borç · limit kullanımı{' '}
              <span className="serit-num font-semibold text-ink">{formatPercent(usageRate)}</span>
            </>
          ) : (
            `${cardsWithDebt.length} kartta borç`
          )
        }
      />

      {totalDebt > 0 ? (
        <div className="mt-[18px]">
          <BreakdownBar
            height={8}
            segments={[
              { label: 'Ekstre', value: buckets.statement, tone: 'danger' },
              { label: 'Dönem içi', value: buckets.current, tone: 'warning' },
              { label: 'Provizyon', value: buckets.provision, tone: 'info' },
            ]}
          />
        </div>
      ) : null}

      {/* Ekranın TEK yükseltilmiş bloğu: ödenmesi gereken ekstre. */}
      {dueStatement && dueStatementCard ? (
        <section className="mt-6 rounded-[14px] border border-line-strong bg-raised p-4">
          <p className="serit-eyebrow" style={{ color: SERIT_TEXT.danger }}>
            Ödenecek ekstre
          </p>
          <p className="mt-1.5 text-[14.5px] font-semibold text-ink">
            {dueStatementCard.card_name} · {dueStatementCard.bank_name}
          </p>
          <p className="serit-num mt-2 text-[26px] font-semibold text-ink" style={{ letterSpacing: '-0.03em' }}>
            {seritAmount(dueStatement.statement_debt_amount).amount} ₺
          </p>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Son ödeme {formatDate(dueStatement.due_date)} · kalan dönem içi harcama sonraki ekstrede ödenir.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void openStatementPayment(dueStatement, dueStatementCard)}
              className="rounded-[9px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition-colors duration-[120ms] hover:brightness-95"
            >
              Öde
            </button>
            <Link
              to="/kartlar?section=ekstreler"
              className="rounded-[9px] border border-line-strong px-4 py-2 text-[13px] font-semibold text-ink-muted transition-colors duration-[120ms] hover:bg-black/[.02] dark:hover:bg-white/[.03]"
            >
              Ekstreyi gör
            </Link>
          </div>
        </section>
      ) : null}

      <section className="mt-7">
        <SectionEyebrow className="mb-1">Kartlar</SectionEyebrow>

        {creditCards.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">
            Kredi kartın yok. Kart eklemek ve yönetmek için{' '}
            <Link to="/kartlar" className="font-semibold text-primary hover:underline">
              Hesaplar
            </Link>{' '}
            sayfasına git.
          </p>
        ) : cardsWithDebt.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-muted">Kredi kartlarında borç yok.</p>
        ) : (
          <LineGroup>
            {cardsWithDebt.map((card) => {
              const period = getCardStatementPeriod(card, new Date())
              const payable = cardPayableDebt(card)
              const openStatement = openStatements.find((statement) => statement.card_id === card.id)
              const cardUsage = card.credit_limit > 0 ? (card.debt_amount / card.credit_limit) * 100 : null
              const dueLabel = openStatement?.due_date
                ? formatDate(openStatement.due_date)
                : period
                  ? formatDate(period.dueDate)
                  : 'Gün eksik'

              return (
                <div key={card.id} className="py-[13px]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {/* 3px renkli sol çubuk: kartı listede kimliklendirir. */}
                      <span
                        aria-hidden="true"
                        className="h-8 w-[3px] shrink-0 rounded-full"
                        style={{ background: card.debt_amount > 0 ? SERIT_TEXT.danger : SERIT_TEXT.neutral }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[14.5px] font-semibold text-ink">{card.card_name}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {card.bank_name} · son ödeme {dueLabel}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="serit-num text-[17px] font-semibold text-ink">{seritAmount(card.debt_amount).amount} ₺</p>
                      {cardUsage === null ? null : (
                        <p className="serit-num mt-0.5 text-[11px] text-ink-muted">{formatPercent(cardUsage)} limit</p>
                      )}
                    </div>
                  </div>

                  {!openStatement && payable > 0 ? (
                    <button
                      type="button"
                      onClick={() => void openDebtPayment(card)}
                      className="mt-2 text-[13px] font-semibold transition-opacity duration-[120ms] hover:opacity-80"
                      style={{ color: SERIT_TEXT.brand }}
                    >
                      Kart borcunu öde →
                    </button>
                  ) : null}
                </div>
              )
            })}
          </LineGroup>
        )}
      </section>

      <FinancePaymentDrawer {...drawerProps} />
    </div>
  )
}
