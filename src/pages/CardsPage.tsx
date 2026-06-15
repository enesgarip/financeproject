import { useState } from 'react'
import { CrudPage } from '../components/CrudPage'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { StatementImportModal } from '../components/finance/StatementImportModal'
import { CardInstallmentCalendarPanel } from '../components/finance/CardInstallmentCalendarPanel'
import { CardInstallmentExpensesPanel } from '../components/finance/CardInstallmentExpensesPanel'
import type { Card, CardStatementArchive } from '../types/database'
import { formatDate } from '../utils/date'
import { isMissingSupabaseCapabilityError } from '../utils/supabaseErrors'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import {
  AccountHubPanel,
  CardSectionNav,
  CreditCardOverview,
  DueStatementAutomation,
  ProvisionPanel,
  StatementPanel,
  type CardSection,
} from './CardsPage.sections'
import { QuickExpensePanel } from './CardsPage.expense'
import { CreditAccountListCard } from './CardsPage.list'
import { LegacyInstallmentPanel } from './CardsPage.installment'
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
  renderCardExtra,
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
            ? 'Ekstre odeme altyapisi canli veritabanina uygulanmamis. Migration calisinca bu islem acilacak.'
            : error.message ?? 'Ekstre ödenemedi.',
        onSubmitEnd: () => setStatementActionId(null),
        onSubmitStart: () => setStatementActionId(statement.id),
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
                  <AccountHubPanel rows={cardRows} onOpenTransfer={(source) => openTransaction(source, reload, cardRows, 'transfer')} />
                  <CreditCardOverview rows={cardRows} />
                </>
              ) : null}

              {!loading && section === 'islemler' ? (
                <>
                  <QuickExpensePanel rows={cardRows} reload={() => refreshCardsAndProvisions(reload)} setError={setError} focus={quickExpenseFocus} />
                  <CardInstallmentExpensesPanel
                    cards={cardRows}
                    reload={() => refreshCardsAndProvisions(reload)}
                    setError={setError}
                  />
                  {cardRows.some((row) => row.card_type === 'kredi_karti') ? (
                    <details className="rounded-lg border border-border/75 bg-card/80 p-3 shadow-sm">
                      <summary className="cursor-pointer text-sm font-bold text-foreground">Eski taksit devri</summary>
                      <div className="mt-3">
                        <LegacyInstallmentPanel rows={cardRows} reload={() => refreshCardsAndProvisions(reload)} setError={setError} />
                      </div>
                    </details>
                  ) : null}
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
            onTransfer={(source) => openTransaction(source, helpers.reload, helpers.rows as Card[], 'transfer')}
            onAddExpense={focusQuickExpense}
            onImportStatement={setImportCard}
            onChanged={() => refreshCardsAndProvisions(helpers.reload)}
          />
        )}
        renderExtra={renderCardExtra}
        getCardClassName={getCardClassName}
        getDetailClassName={getDetailClassName}
        getCardStyle={getCardStyle}
        getDetailStyle={getDetailStyle}
        groupBy={groupCard}
        renderRowActions={(row, helpers) => renderCardRowActions(row, helpers, openTransaction)}
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
          onSuccess={() => {
            setImportCard(null)
            void Promise.all([reloadCards?.(), loadStatements(), loadInstallments(), invalidateSnapshot()])
          }}
        />
      )}

      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}
