import { ReceiptText } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CrudPage } from '../components/CrudPage'
import { AccountPaymentModal } from '../components/finance/AccountPaymentModal'
import { StatementImportModal } from '../components/finance/StatementImportModal'
import { CardInstallmentCalendarPanel } from '../components/finance/CardInstallmentCalendarPanel'
import { CardInstallmentExpensesPanel } from '../components/finance/CardInstallmentExpensesPanel'
import type { Card } from '../types/database'
import { formatDate } from '../utils/date'
import { cardProvisionAmount, cardSplitTotal } from '../utils/financeSummary'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
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
import { useAccountMovementModal, useCardsPageData, useStatementPaymentModal } from './CardsPage.hooks'
import {
  bankHueStyle,
  cardGroupLabel,
  cardTypeLabel,
  fields,
  limitGroupStats,
  optionalDay,
  statementPeriodLabel,
} from './CardsPage.helpers'

const cardSectionIds: CardSection[] = ['ozet', 'kartlar', 'islemler', 'ekstreler']

function parseCardSection(value: string | null): CardSection {
  return cardSectionIds.includes(value as CardSection) ? (value as CardSection) : 'ozet'
}

export function CardsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const section = parseCardSection(searchParams.get('section'))
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
  const {
    statementPayment,
    statementPaymentAccounts,
    statementPaymentError,
    statementPaymentSaving,
    statementPaymentSourceCard,
    closeStatementPayment,
    handleStatementPaymentSubmit,
    openStatementPayment,
    setStatementPaymentSourceCard,
  } = useStatementPaymentModal({
    invalidateSnapshot,
    loadInstallments,
    loadStatements,
    reloadCards,
    setReloadCards,
    setStatementActionId,
  })
  const [importCard, setImportCard] = useState<Card | null>(null)

  const [quickExpenseFocus, setQuickExpenseFocus] = useState<{ cardId: string; mode: 'cash' | 'installment'; nonce: number } | null>(null)

  const handleSectionChange = useCallback((next: CardSection) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'ozet') nextParams.delete('section')
    else nextParams.set('section', next)
    setSearchParams(nextParams, { replace: true })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [searchParams, setSearchParams])

  const focusQuickExpense = useCallback((card: Card, mode: 'cash' | 'installment') => {
    setQuickExpenseFocus({ cardId: card.id, mode, nonce: Date.now() })
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('section', 'islemler')
    setSearchParams(nextParams, { replace: true })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [searchParams, setSearchParams])

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
        getInitialValues={(row?: Card) => ({
          bank_name: row?.bank_name ?? '',
          card_name: row?.card_name ?? '',
          card_type: row?.card_type ?? 'kredi_karti',
          holder_name: row?.holder_name ?? '',
          limit_group_name: row?.limit_group_name ?? '',
          current_balance: row?.current_balance ?? 0,
          credit_limit: row?.credit_limit ?? 0,
          statement_debt_amount: row?.statement_debt_amount ?? row?.debt_amount ?? 0,
          current_period_spending: row?.current_period_spending ?? 0,
          provision_amount: row?.provision_amount ?? 0,
          statement_day: row?.statement_day ?? '',
          due_day: row?.due_day ?? '',
          note: row?.note ?? '',
        })}
        mapForm={(formData, userId) => {
          const cardType = formData.get('card_type') as Card['card_type']
          const isCreditCard = cardType === 'kredi_karti'
          const statementDebt = isCreditCard ? parseNumber(formData.get('statement_debt_amount')) : 0
          const currentPeriod = isCreditCard ? parseNumber(formData.get('current_period_spending')) : 0
          const provisionAmount = isCreditCard ? parseNumber(formData.get('provision_amount')) : 0

          return {
            user_id: userId,
            bank_name: String(formData.get('bank_name') ?? ''),
            card_name: String(formData.get('card_name') ?? ''),
            card_type: cardType,
            holder_name: isCreditCard ? String(formData.get('holder_name') ?? '').trim() || null : null,
            limit_group_name: isCreditCard ? String(formData.get('limit_group_name') ?? '').trim() || null : null,
            current_balance: isCreditCard ? 0 : parseNumber(formData.get('current_balance')),
            credit_limit: isCreditCard ? parseNumber(formData.get('credit_limit')) : 0,
            debt_amount: isCreditCard ? cardSplitTotal(statementDebt, currentPeriod, provisionAmount) : 0,
            statement_debt_amount: statementDebt,
            current_period_spending: currentPeriod,
            provision_amount: provisionAmount,
            statement_day: isCreditCard ? optionalDay(formData.get('statement_day')) : null,
            due_day: isCreditCard ? optionalDay(formData.get('due_day')) : null,
            note: String(formData.get('note') ?? '') || null,
          }
        }}
        renderTitle={(row) => row.card_name}
        renderSubtitle={(row) => `${row.bank_name} · ${cardTypeLabel(row.card_type)}`}
        renderDetails={(row) =>
          row.card_type === 'kredi_karti'
            ? [
                row.holder_name ? `Kart sahibi: ${row.holder_name}` : 'Kart sahibi: -',
                row.limit_group_name ? `Ortak limit: ${row.limit_group_name}` : 'Ortak limit: -',
                `Limit: ${formatCurrency(row.credit_limit)}`,
                `Toplam borç: ${formatCurrency(row.debt_amount)}`,
                `Ekstre borcu: ${formatCurrency(row.statement_debt_amount)}`,
                `Dönem içi kesinleşen: ${formatCurrency(row.current_period_spending)}`,
                `Provizyon: ${formatCurrency(cardProvisionAmount(row))}`,
                `Ekstre: ${row.statement_day ? `Her ayın ${row.statement_day}. günü` : '-'}`,
                `Son ödeme: ${row.due_day ? `Her ayın ${row.due_day}. günü` : '-'}`,
              ]
            : [`Bakiye: ${formatCurrency(row.current_balance)}`]
        }
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
        renderExtra={(row, helpers) => {
          if (row.card_type !== 'kredi_karti' || row.credit_limit <= 0) return null

          const stats = limitGroupStats(row, helpers.rows as Card[])
          return (
            <div className="mt-3 rounded-xl border border-border/50 bg-muted/30 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{stats.isShared ? 'Ortak limit kullanımı' : 'Limit kullanımı'}</span>
                <span className="font-mono font-semibold tabular-nums text-foreground">{Math.round(stats.usageRate)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-info transition-all duration-500"
                  style={{ width: `${stats.usageRate}%` }}
                />
              </div>
              {stats.isShared ? (
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-muted-foreground min-[430px]:grid-cols-3">
                  <span>Grup borcu: {formatCurrency(stats.totalDebt)}</span>
                  <span>Provizyon: {formatCurrency(stats.provisionAmount)}</span>
                  <span>Kalan limit: {formatCurrency(stats.availableLimit)}</span>
                </div>
              ) : null}
            </div>
          )
        }}
        getCardClassName={() =>
          'border-[hsl(var(--bank-hue)_52%_78%)] bg-[hsl(var(--bank-hue)_58%_98%)] dark:border-[hsl(var(--bank-hue)_42%_34%)] dark:bg-[hsl(var(--bank-hue)_38%_15%)]'
        }
        getDetailClassName={() => 'bg-[hsl(var(--bank-hue)_46%_96%)] dark:bg-[hsl(var(--bank-hue)_34%_20%)]'}
        getCardStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        getDetailStyle={(row, rows) => bankHueStyle(row.bank_name, rows)}
        groupBy={(row) => cardGroupLabel(row)}
        renderRowActions={(row, helpers) =>
          row.card_type === 'banka_karti' ? (
            <button
              type="button"
              onClick={() => openTransaction(row, helpers.reload, helpers.rows as Card[])}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97]"
            >
              <ReceiptText size={14} />
              Para hareketi
            </button>
          ) : null
        }
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

      <AccountPaymentModal
        title="Ekstre ödemesi"
        open={Boolean(statementPayment)}
        onClose={closeStatementPayment}
        accounts={statementPaymentAccounts}
        selectedAccountId={statementPaymentSourceCard}
        onSelectedAccountChange={setStatementPaymentSourceCard}
        amountValue={String(statementPayment?.statement.statement_debt_amount ?? 0)}
        onAmountValueChange={() => undefined}
        amountEditable={false}
        submitLabel="Ekstreyi öde"
        saving={statementPaymentSaving}
        externalError={statementPaymentError}
        successAction
        info="Bu ekstre kapandığında ekstreye bağlı kredi kartı taksitleri otomatik ödenmiş olur."
        onSubmit={handleStatementPaymentSubmit}
      >
        <p className="font-semibold text-foreground">{statementPayment?.card.card_name}</p>
        <p>Ekstre: {statementPayment ? statementPeriodLabel(statementPayment.statement) : '-'}</p>
        <p>Son ödeme: {statementPayment ? formatDate(statementPayment.statement.due_date) : '-'}</p>
      </AccountPaymentModal>
    </>
  )
}
