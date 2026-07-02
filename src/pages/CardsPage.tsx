/**
 * `/kartlar` orkestratörü: kredi kartları + banka hesapları sayfası. Bu dosya
 * sadece üst seviye akışı kurar; gerçek parçalar ayrı modüllere bölünmüştür ki
 * tek dev dosya olmasın:
 *   .hooks      → veri çekme/state (useCardsPageData, modal hook'ları)
 *   .crud       → CrudPage için kart formu/satır render'ları
 *   .overview / .statements / .sections / .expense / .list / .installment
 *               → ekrandaki panel grupları
 *   .helpers    → alan tanımları, küçük saf yardımcılar
 * Kart borcu matematiği util'lerde (financeSummary.ts, cardStatement.ts,
 * cardLedger.ts); yazma işlemleri repo/servis katmanında (cardsRepo.ts,
 * accountMovements.ts).
 *
 * Kart borç alanları nasıl hareket eder (debt_amount, statement_debt_amount,
 * current_period_spending, provision_amount): docs/CARD_DEBT_TRANSITIONS.md.
 * Sayfa veri akışı ve modül haritası: docs/CARDS_ARCHITECTURE.md.
 */
import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Eye, EyeOff, FileText, History, Info, ScanSearch, ShieldCheck } from 'lucide-react'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import { CrudPage } from '../components/CrudPage'
import { CurrentMovementImportModal } from '../components/finance/CurrentMovementImportModal'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { StatementImportModal } from '../components/finance/StatementImportModal'
import { CardInstallmentCalendarPanel } from '../components/finance/CardInstallmentCalendarPanel'
import { CardInstallmentExpensesPanel } from '../components/finance/CardInstallmentExpensesPanel'
import type { Card, CardStatementArchive } from '../types/database'
import { dateInputValue, formatDate } from '../utils/date'
import { cardPayableDebt } from '../utils/financeSummary'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { AccountHubPanel, CreditCardOverview } from './CardsPage.overview'
import { ProvisionPanel, StatementPanel } from './CardsPage.statements'
import {
  CardSectionNav,
  DueStatementAutomation,
  type CardSection,
} from './CardsPage.sections'
import { QuickExpensePanel } from './CardsPage.expense'
import { CreditAccountListCard } from './CardsPage.list'
import { MovementModal } from './CardsPage.movementModal'
import { useAccountMovementModal, useCardSectionNavigation, useCardsPageData } from './CardsPage.hooks'
import {
  getCardClassName,
  getCardInitialValues,
  getCardStyle,
  getDetailClassName,
  getDetailStyle,
  groupCard,
  mapCardForm,
  renderCardDetails,
  renderCardRowActions,
  renderCardSubtitle,
  renderCardTitle,
} from './CardsPage.crud'
import {
  fields,
  statementPeriodLabel,
} from './CardsPage.helpers'

export function CardsPage() {
  const { focusQuickExpense, handleSectionChange, quickExpenseFocus, section } = useCardSectionNavigation()
  const { formatAmount, hidden: balancesHidden, toggleHidden: toggleBalancesHidden } = useBalancePrivacy()
  const { setActions, clearActions } = useHeaderActions()

  useEffect(() => {
    setActions(
      <button
        type="button"
        onClick={toggleBalancesHidden}
        aria-pressed={balancesHidden}
        className="grid size-9 place-items-center rounded-xl border border-border/70 bg-card/80 text-muted-foreground backdrop-blur-sm transition hover:bg-muted hover:text-foreground"
        aria-label={balancesHidden ? 'Tutarları göster' : 'Tutarları gizle'}
      >
        {balancesHidden ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>,
    )
    return clearActions
  }, [balancesHidden, toggleBalancesHidden, setActions, clearActions])
  const {
    installments,
    invalidateSnapshot,
    loadInstallments,
    loadStatements,
    provisionActionId,
    provisionError,
    provisions,
    provisionsLoading,
    refreshCardsAndProvisions,
    statementActionId,
    statementError,
    statements,
    statementsLoading,
    handlePostAllProvisions,
    handleProvisionAction,
    setStatementActionId,
  } = useCardsPageData()
  const [reloadCards, setReloadCards] = useState<(() => Promise<void>) | null>(null)
  const {
    transactionAmount,
    transactionCard,
    transactionError,
    transactionSaving,
    transactionTargetAccounts,
    transactionTargetCard,
    transactionType,
    closeTransaction,
    handleTransactionSubmit,
    handleTransactionTargetCardChange,
    handleTransactionTypeChange,
    openTransaction,
    setTransactionAmount,
  } = useAccountMovementModal({ invalidateSnapshot, reloadCards, setReloadCards })
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()
  const [importCard, setImportCard] = useState<Card | null>(null)
  const [movementImportCard, setMovementImportCard] = useState<Card | null>(null)
  const [postImportBanner, setPostImportBanner] = useState(false)
  // Banka hesabı hareket paneli ⋮ menüden açılır; hangi hesapların paneli
  // açık, satır bileşeni yerine burada tutulur (menü CrudPage'de render edilir).
  const [ledgerOpenIds, setLedgerOpenIds] = useState<Set<string>>(new Set())
  const [detailOpenIds, setDetailOpenIds] = useState<Set<string>>(new Set())

  const toggleLedgerPanel = useCallback((cardId: string) => {
    setLedgerOpenIds((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }, [])

  const toggleDetailPanel = useCallback((cardId: string) => {
    setDetailOpenIds((current) => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }, [])

  const handleImportSuccess = useCallback(async (setter: (v: null) => void) => {
    setter(null)
    await Promise.all([reloadCards?.(), loadStatements(), loadInstallments(), invalidateSnapshot()])
    setPostImportBanner(true)
  }, [reloadCards, loadStatements, loadInstallments, invalidateSnapshot])

  async function openStatementPayment(statement: CardStatementArchive, card: Card, cards: Card[], reload: () => Promise<void>) {
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
        reload,
        afterSuccess: async () => {
          await Promise.all([loadStatements(), loadInstallments(), invalidateSnapshot()])
        },
        detail: (
          <>
            <p className="font-semibold text-foreground">{card.card_name}</p>
            <p>Ekstre: {statementPeriodLabel(statement)}</p>
            <p>Son ödeme: {formatDate(statement.due_date)}</p>
          </>
        ),
        formatSubmitError: (error) =>
          isMissingSupabaseCapabilityError(error)
            ? missingSupabaseCapabilityMessage('Ekstre ödeme altyapısı', error)
            : error.message ?? 'Ekstre ödenemedi.',
        onSubmitEnd: () => setStatementActionId(null),
        onSubmitStart: () => setStatementActionId(statement.id),
      },
    )
  }

  // Ekstre kesilmesini beklemeden kart borcu ödeme: pay_card_debt RPC'si önce
  // ekstre borcunu, kalanı dönem içi harcamayı düşer; üst sınır ödenebilir borç
  // (provizyon + gelecek taksitler hariç). Tutar çekmecede düzenlenebilir.
  async function openDebtPayment(card: Card, cards: Card[], reload: () => Promise<void>) {
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
        reload,
        afterSuccess: async () => {
          await Promise.all([loadStatements(), loadInstallments(), invalidateSnapshot()])
        },
        detail: (
          <>
            <p className="font-semibold text-foreground">{card.card_name}</p>
            <p>Ekstre borcu: {formatAmount(card.statement_debt_amount)}</p>
            <p>Dönem içi harcama: {formatAmount(card.current_period_spending)}</p>
            <p>
              Ödenebilir toplam:{' '}
              <span className="font-mono font-semibold text-foreground">{formatAmount(cardPayableDebt(card))}</span>
            </p>
          </>
        ),
        formatSubmitError: (error) =>
          isMissingSupabaseCapabilityError(error)
            ? missingSupabaseCapabilityMessage('Kart borcu ödeme altyapısı', error)
            : error.message ?? 'Kart borcu ödenemedi.',
      },
    )
  }

  return (
    <>
      <CrudPage
        table="cards"
        pageTitle="Hesaplar ve kartlar"
        addLabel="Hesap / kart ekle"
        fields={fields}
        emptyTitle="Henüz kart yok"
        emptyDescription="Banka hesaplarını ve kredi kartlarını buradan takip edebilirsin."
        orderBy="card_type"
        showList={section === 'kartlar'}
        afterSave={async () => {
          await invalidateSnapshot()
        }}
        afterDelete={async () => {
          await invalidateSnapshot()
        }}
        renderBeforeList={({ loading, rows, reload, setError }) => {
          const cardRows = rows as Card[]
          const counts: Partial<Record<CardSection, number>> = {
            kartlar: cardRows.length,
            ekstreler:
              statements.filter((statement) => statement.status === 'open').length +
              provisions.filter((expense) => expense.status === 'provision').length,
          }

          return (
            <div className="flex flex-col gap-3">
              {postImportBanner ? (
                <div className="flex items-center gap-3 rounded-xl border border-info/25 bg-info/8 p-3">
                  <ShieldCheck size={18} className="shrink-0 text-info" />
                  <p className="flex-1 text-sm font-medium text-info">İçe aktarma tamamlandı. Veri tutarlılığını kontrol etmeni öneriyoruz.</p>
                  <Link
                    to="/veri-sagligi"
                    className="shrink-0 rounded-lg bg-info px-3 py-1.5 text-xs font-bold text-white transition hover:bg-info/90"
                    onClick={() => setPostImportBanner(false)}
                  >
                    Kontrol et
                  </Link>
                  <button type="button" onClick={() => setPostImportBanner(false)} className="shrink-0 text-xs font-bold text-info hover:underline">
                    Kapat
                  </button>
                </div>
              ) : null}
              <CardSectionNav section={section} onSelect={handleSectionChange} counts={counts} />
              {!loading ? (
                <DueStatementAutomation
                  rows={cardRows}
                  statements={statements}
                  statementsLoading={statementsLoading}
                  reload={async () => {
                    await Promise.all([reload(), invalidateSnapshot()])
                  }}
                  loadStatements={loadStatements}
                  setError={setError}
                />
              ) : null}

              {!loading && section === 'ozet' ? (
                <>
                  <AccountHubPanel rows={cardRows} onOpenTransfer={(source) => openTransaction(source, reload, cardRows, 'transfer')} formatAmount={formatAmount} />
                  <CreditCardOverview rows={cardRows} formatAmount={formatAmount} />
                </>
              ) : null}

              {!loading && section === 'islemler' ? (
                <>
                  <QuickExpensePanel rows={cardRows} reload={() => refreshCardsAndProvisions(reload)} setError={setError} focus={quickExpenseFocus} formatAmount={formatAmount} />
                  <CardInstallmentExpensesPanel
                    cards={cardRows}
                    reload={() => refreshCardsAndProvisions(reload)}
                    setError={setError}
                  />
                </>
              ) : null}

              {!loading && section === 'ekstreler' ? (
                <>
                  {statementError ? (
                    <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{statementError}</p>
                  ) : null}
                  <StatementPanel
                    rows={cardRows}
                    statements={statements}
                    loading={statementsLoading}
                    actionId={statementActionId}
                    onPay={(statement, card) => openStatementPayment(statement, card, cardRows, reload)}
                  />
                  {provisionError ? (
                    <p className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm font-medium text-warning">{provisionError}</p>
                  ) : null}
                  <ProvisionPanel
                    rows={cardRows}
                    provisions={provisions}
                    loading={provisionsLoading}
                    actionId={provisionActionId}
                    onPost={(expense) => void handleProvisionAction(expense, 'post', reload, setError)}
                    onPostAll={(expenses) => void handlePostAllProvisions(expenses, reload, setError)}
                    onCancel={(expense) => void handleProvisionAction(expense, 'cancel', reload, setError)}
                  />
                  <CardInstallmentCalendarPanel cards={cardRows} />
                </>
              ) : null}
            </div>
          )
        }}
        getInitialValues={getCardInitialValues}
        mapForm={mapCardForm}
        renderTitle={renderCardTitle}
        renderSubtitle={renderCardSubtitle}
        renderDetails={renderCardDetails}
        renderCard={(row, helpers) => (
          <CreditAccountListCard
            row={row as Card}
            rows={helpers.rows as Card[]}
            statements={statements}
            installments={installments}
            menu={helpers.menu}
            rowActions={helpers.rowActions}
            ledgerOpen={ledgerOpenIds.has(row.id)}
            detailsOpen={detailOpenIds.has(row.id)}
            balancesHidden={balancesHidden}
            formatAmount={formatAmount}
            onPayDebt={(card) => void openDebtPayment(card, helpers.rows as Card[], helpers.reload)}
            onAddExpense={focusQuickExpense}
            onChanged={() => refreshCardsAndProvisions(helpers.reload)}
          />
        )}
        getCardClassName={getCardClassName}
        getDetailClassName={getDetailClassName}
        getCardStyle={getCardStyle}
        getDetailStyle={getDetailStyle}
        groupBy={groupCard}
        renderRowActions={(row, helpers) => renderCardRowActions(row, helpers, openTransaction)}
        renderMenuActions={(row, menuHelpers) => {
          const card = row as Card
          if (card.card_type === 'kredi_karti') {
            return (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    menuHelpers.closeMenu()
                    toggleDetailPanel(card.id)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <Info size={14} />
                  {detailOpenIds.has(card.id) ? 'Detayı gizle' : 'Detay'}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    menuHelpers.closeMenu()
                    focusQuickExpense(card, 'installment')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <CalendarClock size={14} />
                  Taksit ekle
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    menuHelpers.closeMenu()
                    setImportCard(card)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <FileText size={14} />
                  Ekstre içe aktar
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    menuHelpers.closeMenu()
                    setMovementImportCard(card)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  <ScanSearch size={14} />
                  Mutabakat
                </button>
              </>
            )
          }
          if (card.card_type !== 'banka_karti') return null
          return (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                menuHelpers.closeMenu()
                toggleLedgerPanel(card.id)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
            >
              <History size={14} />
              {ledgerOpenIds.has(card.id) ? 'Hareketleri gizle' : 'Hareketler'}
            </button>
          )
        }}
      />

      <MovementModal
        card={transactionCard}
        type={transactionType}
        amount={transactionAmount}
        targetCardId={transactionTargetCard}
        targetAccounts={transactionTargetAccounts}
        error={transactionError}
        saving={transactionSaving}
        onClose={closeTransaction}
        onTypeChange={handleTransactionTypeChange}
        onAmountChange={setTransactionAmount}
        onTargetCardChange={handleTransactionTargetCardChange}
        onSubmit={handleTransactionSubmit}
      />

      {importCard && (
        <StatementImportModal
          card={importCard}
          onClose={() => setImportCard(null)}
          onSuccess={() => void handleImportSuccess(setImportCard)}
        />
      )}

      {movementImportCard && (
        <CurrentMovementImportModal
          card={movementImportCard}
          onClose={() => setMovementImportCard(null)}
          onSuccess={() => void handleImportSuccess(setMovementImportCard)}
        />
      )}

      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}
