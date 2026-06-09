import { ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrudPage } from '../components/CrudPage'
import { AccountPaymentModal } from '../components/finance/AccountPaymentModal'
import { StatementImportModal } from '../components/finance/StatementImportModal'
import { CardInstallmentCalendarPanel } from '../components/finance/CardInstallmentCalendarPanel'
import { CardInstallmentExpensesPanel } from '../components/finance/CardInstallmentExpensesPanel'
import { SimpleModal } from '../components/SimpleModal'
import { supabase } from '../lib/supabase'
import { submitAccountMovement } from '../services/accountMovements'
import { submitFinanceObligationPayment } from '../services/financePaymentActions'
import type { Card, CardExpense, CardInstallment, CardStatementArchive } from '../types/database'
import { formatDate } from '../utils/date'
import { cardProvisionAmount, cardSplitTotal } from '../utils/financeSummary'
import { getLastUsed, resolvePreferred, setLastUsed } from '../utils/lastUsed'
import { formatCurrency, parseNumber } from '../utils/formatCurrency'
import { addTransactionHistory } from '../utils/history'
import {
  AccountHubPanel,
  CardSectionNav,
  CreditAccountListCard,
  CreditCardOverview,
  DueStatementAutomation,
  LegacyInstallmentPanel,
  ProvisionPanel,
  QuickExpensePanel,
  StatementPanel,
  type CardSection,
} from './CardsPage.sections'
import {
  bankHueStyle,
  cardGroupLabel,
  cardTypeLabel,
  fields,
  isSchemaCacheError,
  limitGroupStats,
  optionalDay,
  statementPeriodLabel,
} from './CardsPage.helpers'

export function CardsPage() {
  const [section, setSection] = useState<CardSection>('ozet')
  const [transactionCard, setTransactionCard] = useState<Card | null>(null)
  const [transactionType, setTransactionType] = useState<'in' | 'out' | 'transfer'>('in')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [transactionTargetCard, setTransactionTargetCard] = useState('')
  const [transactionError, setTransactionError] = useState('')
  const [transactionSaving, setTransactionSaving] = useState(false)
  const [movementAccounts, setMovementAccounts] = useState<Card[]>([])
  const [reloadCards, setReloadCards] = useState<(() => Promise<void>) | null>(null)
  const [provisions, setProvisions] = useState<CardExpense[]>([])
  const [provisionsLoading, setProvisionsLoading] = useState(false)
  const [provisionError, setProvisionError] = useState('')
  const [provisionActionId, setProvisionActionId] = useState<string | null>(null)
  const [statements, setStatements] = useState<CardStatementArchive[]>([])
  const [statementsLoading, setStatementsLoading] = useState(false)
  const [statementError, setStatementError] = useState('')
  const [statementActionId, setStatementActionId] = useState<string | null>(null)
  const [installments, setInstallments] = useState<CardInstallment[]>([])
  const [statementPayment, setStatementPayment] = useState<{ statement: CardStatementArchive; card: Card } | null>(null)
  const [statementPaymentAccounts, setStatementPaymentAccounts] = useState<Card[]>([])
  const [statementPaymentSourceCard, setStatementPaymentSourceCard] = useState('')
  const [statementPaymentError, setStatementPaymentError] = useState('')
  const [statementPaymentSaving, setStatementPaymentSaving] = useState(false)
  const [importCard, setImportCard] = useState<Card | null>(null)

  const loadProvisions = useCallback(async () => {
    setProvisionsLoading(true)
    setProvisionError('')
    const { data, error } = await supabase
      .from('card_expenses')
      .select('*')
      .eq('status', 'provision')
      .order('spent_at', { ascending: false })

    if (error) {
      setProvisions([])
      setProvisionError(
        isSchemaCacheError(error)
          ? 'Provizyon altyapısı henüz canlı veritabanında yok. Migration uygulanınca bu liste açılacak.'
          : error.message,
      )
    } else {
      setProvisions((data ?? []) as CardExpense[])
    }
    setProvisionsLoading(false)
  }, [])

  const loadStatements = useCallback(async () => {
    setStatementsLoading(true)
    setStatementError('')
    const { data, error } = await supabase
      .from('card_statement_archives')
      .select('*')
      .order('statement_date', { ascending: false })
      .limit(24)

    if (error) {
      setStatements([])
      setStatementError(
        isSchemaCacheError(error)
          ? 'Ekstre odeme altyapisi henuz canli veritabaninda yok. Migration uygulaninca bu panel acilacak.'
          : error.message,
      )
    } else {
      setStatements((data ?? []) as CardStatementArchive[])
    }
    setStatementsLoading(false)
  }, [])

  const loadInstallments = useCallback(async () => {
    const { data, error } = await supabase
      .from('card_installments')
      .select('*')
      .order('due_month', { ascending: true })

    if (error) {
      setInstallments([])
      return
    }

    setInstallments((data ?? []) as CardInstallment[])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProvisions()
  }, [loadProvisions])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatements()
  }, [loadStatements])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstallments()
  }, [loadInstallments])

  async function refreshCardsAndProvisions(reload: () => Promise<void>) {
    await Promise.all([reload(), loadProvisions(), loadStatements(), loadInstallments()])
  }

  async function handleProvisionAction(
    expense: CardExpense,
    action: 'post' | 'cancel',
    reload: () => Promise<void>,
    setError: (message: string) => void,
  ) {
    setProvisionActionId(`${action}-${expense.id}`)
    setError('')
    setProvisionError('')

    const rpcName = action === 'post' ? 'post_card_provision' : 'cancel_card_provision'
    const { error } = await supabase.rpc(rpcName, { p_expense_id: expense.id })

    if (error) {
      const message = isSchemaCacheError(error)
        ? 'Provizyon altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
        : error.message
      setError(message)
      setProvisionActionId(null)
      return
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  async function handlePostAllProvisions(expenses: CardExpense[], reload: () => Promise<void>, setError: (message: string) => void) {
    const pendingExpenses = expenses.filter((expense) => expense.status === 'provision')
    if (pendingExpenses.length === 0) return

    setProvisionActionId('post-all')
    setError('')
    setProvisionError('')

    for (const expense of pendingExpenses) {
      const { error } = await supabase.rpc('post_card_provision', { p_expense_id: expense.id })
      if (error) {
        setError(
          isSchemaCacheError(error)
            ? 'Provizyon altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
            : error.message,
        )
        await refreshCardsAndProvisions(reload)
        setProvisionActionId(null)
        return
      }
    }

    await refreshCardsAndProvisions(reload)
    setProvisionActionId(null)
  }

  function openTransaction(card: Card, reload: () => Promise<void>, cards: Card[], type: 'in' | 'out' | 'transfer' = 'in') {
    const accounts = cards.filter((row) => row.card_type === 'banka_karti')
    setTransactionCard(card)
    setReloadCards(() => reload)
    setMovementAccounts(accounts)
    setTransactionType(type)
    setTransactionAmount('')
    setTransactionTargetCard('')
    setTransactionError('')
  }

  async function handleTransactionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!transactionCard) return

    const amount = parseNumber(transactionAmount)
    setTransactionSaving(true)
    setTransactionError('')
    const { error } = await submitAccountMovement({
      sourceAccount: transactionCard,
      targetAccount: movementAccounts.find((card) => card.id === transactionTargetCard),
      type: transactionType,
      amount,
    })

    setTransactionSaving(false)
    if (error) {
      setTransactionError(error.message ?? 'Para hareketi tamamlanamadı.')
      return
    }

    setTransactionCard(null)
    await reloadCards?.()
  }

  function openStatementPayment(statement: CardStatementArchive, card: Card, cards: Card[], reload: () => Promise<void>) {
    const accounts = cards.filter((row) => row.card_type === 'banka_karti' && row.id !== card.id)
    setStatementPayment({ statement, card })
    setStatementPaymentAccounts(accounts)
    setStatementPaymentSourceCard(resolvePreferred(getLastUsed('paymentAccount'), accounts.map((account) => account.id)))
    setStatementPaymentError(accounts.length === 0 ? 'Ekstre odemesi icin once bir banka hesabi eklemelisin.' : '')
    setReloadCards(() => reload)
  }

  function closeStatementPayment() {
    setStatementPayment(null)
    setStatementPaymentSourceCard('')
    setStatementPaymentError('')
  }

  async function handleStatementPaymentSubmit({ account: sourceCard }: { account: Card; amount: number }) {
    if (!statementPayment) return

    setStatementPaymentSaving(true)
    setStatementActionId(statementPayment.statement.id)
    setStatementPaymentError('')

    const { error } = await submitFinanceObligationPayment({
      obligation: {
        id: `card-statement-${statementPayment.statement.id}`,
        kind: 'card_statement',
        action: 'pay_card_statement',
        sourceId: statementPayment.statement.id,
        relatedCardId: statementPayment.card.id,
        title: `${statementPayment.card.card_name} ekstresi`,
        subtitle: statementPayment.card.bank_name,
        date: statementPayment.statement.due_date ?? statementPayment.statement.statement_date,
        amount: statementPayment.statement.statement_debt_amount,
        direction: 'outflow',
      },
      account: sourceCard,
      amount: statementPayment.statement.statement_debt_amount,
    })

    setStatementPaymentSaving(false)
    setStatementActionId(null)

    if (error) {
      setStatementPaymentError(
        isSchemaCacheError(error)
          ? 'Ekstre odeme altyapisi canli veritabanina uygulanmamis. Migration calisinca bu islem acilacak.'
          : error.message ?? 'Ekstre ödenemedi.',
      )
      return
    }

    setLastUsed('paymentAccount', sourceCard.id)
    closeStatementPayment()
    await Promise.all([reloadCards?.(), loadStatements(), loadInstallments()])
  }

  async function cutStatement(card: Card, reload: () => Promise<void>, setError: (message: string) => void) {
    if (card.current_period_spending <= 0) {
      setError('Dönem içi harcama olmadığı için kesilecek ekstre yok.')
      return
    }

    const { error } = await supabase.rpc('cut_card_statement', {
      p_card_id: card.id,
    })

    if (error) {
      if (!isSchemaCacheError(error)) {
        setError(error.message)
        return
      }

      const statementDebt = card.statement_debt_amount + card.current_period_spending
      const { error: updateError } = await supabase
        .from('cards')
        .update({ statement_debt_amount: statementDebt, current_period_spending: 0, updated_at: new Date().toISOString() })
        .eq('id', card.id)

      if (updateError) {
        setError(updateError.message)
        return
      }

      const historyError = await addTransactionHistory({
        user_id: card.user_id,
        type: 'card',
        title: `${card.card_name} ekstresi kesildi`,
        amount: card.current_period_spending,
        source_table: 'cards',
        source_id: card.id,
        note: 'Dönem borcuna aktarıldı.',
      })
      if (historyError) {
        setError(historyError.message)
        return
      }

      await Promise.all([reload(), loadStatements()])
      return
    }

    await Promise.all([reload(), loadStatements()])
  }

  const [quickExpenseFocus, setQuickExpenseFocus] = useState<{ cardId: string; mode: 'cash' | 'installment'; nonce: number } | null>(null)

  const handleSectionChange = useCallback((next: CardSection) => {
    setSection(next)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const focusQuickExpense = useCallback((card: Card, mode: 'cash' | 'installment') => {
    setQuickExpenseFocus({ cardId: card.id, mode, nonce: Date.now() })
    setSection('islemler')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const transactionTarget = movementAccounts.find((card) => card.id === transactionTargetCard)
  const transactionTargetAccounts = movementAccounts.filter((card) => card.id !== transactionCard?.id)
  const transactionAmountValue = parseNumber(transactionAmount)
  const transactionIsTransfer = transactionType === 'transfer'

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
                <DueStatementAutomation rows={cardRows} reload={reload} loadStatements={loadStatements} setError={setError} />
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
                        <LegacyInstallmentPanel rows={cardRows} reload={reload} setError={setError} />
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
            reload={helpers.reload}
            setError={helpers.setError}
            onTransfer={(source) => openTransaction(source, helpers.reload, helpers.rows as Card[], 'transfer')}
            onCutStatement={cutStatement}
            onAddExpense={focusQuickExpense}
            onImportStatement={setImportCard}
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

      <SimpleModal title={transactionIsTransfer ? 'Hesaplar arası transfer' : 'Para hareketi'} open={Boolean(transactionCard)} onClose={() => setTransactionCard(null)}>
        <form onSubmit={handleTransactionSubmit} className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{transactionCard?.card_name}</p>
            <p>Mevcut bakiye: {formatCurrency(transactionCard?.current_balance ?? 0)}</p>
          </div>
          {transactionIsTransfer ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
              <p className="text-xs font-bold uppercase text-muted-foreground">İşlem tipi</p>
              <p className="mt-1 font-semibold text-foreground">Hesaplar arası transfer</p>
            </div>
          ) : (
            <label className="block text-sm font-semibold text-foreground">
              İşlem tipi
              <select
                value={transactionType}
                onChange={(event) => {
                  setTransactionType(event.target.value as 'in' | 'out')
                  setTransactionTargetCard('')
                  setTransactionError('')
                }}
                className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
              >
                <option value="in">Para geldi</option>
                <option value="out">Para gitti</option>
              </select>
            </label>
          )}
          <label className="block text-sm font-semibold text-foreground">
            Tutar
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={transactionAmount}
              onChange={(event) => setTransactionAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-input px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
            />
          </label>
          {transactionIsTransfer ? (
            <>
              <label className="block text-sm font-semibold text-foreground">
                Hedef hesap
                <select
                  required
                  value={transactionTargetCard}
                  onChange={(event) => {
                    setTransactionTargetCard(event.target.value)
                    setTransactionError('')
                  }}
                  className="mt-1 w-full rounded-lg border border-input bg-white px-3 py-3 outline-none transition-all focus:border-ring focus:ring-2 focus:ring-ring/20 dark:bg-card/50 dark:text-foreground"
                >
                  <option value="">{transactionTargetAccounts.length > 0 ? 'Hedef hesap seç' : 'Transfer için ikinci hesap gerekli'}</option>
                  {transactionTargetAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bank_name} · {account.card_name} ({formatCurrency(account.current_balance)})
                    </option>
                  ))}
                </select>
              </label>
              {transactionTarget ? (
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Kaynak sonrası: {formatCurrency((transactionCard?.current_balance ?? 0) - transactionAmountValue)}
                  </span>
                  <span>Hedef sonrası: {formatCurrency(transactionTarget.current_balance + transactionAmountValue)}</span>
                </div>
              ) : null}
            </>
          ) : null}
          {transactionError ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{transactionError}</p> : null}
          <button
            type="submit"
            disabled={transactionSaving}
            className="h-12 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            {transactionSaving ? 'İşleniyor...' : transactionIsTransfer ? 'Transferi tamamla' : 'Bakiyeyi güncelle'}
          </button>
        </form>
      </SimpleModal>

      {importCard && (
        <StatementImportModal
          card={importCard}
          onClose={() => setImportCard(null)}
          onSuccess={() => { setImportCard(null); void reloadCards?.() }}
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
