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
import { Suspense, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, CalendarClock, FileText, ScanSearch, ShieldCheck, List, Clock, ChevronRight } from 'lucide-react'
import { CrudPage } from '../components/CrudPage'
import { CardsPaymentCycle } from '../components/dashboard/CardPaymentCyclePanel'
import { DeferredDetails } from '../components/ui/deferred-details'
import { CategoryCleanupPanel } from '../components/finance/CategoryCleanupPanel'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { CardInstallmentCalendarPanel } from '../components/finance/CardInstallmentCalendarPanel'
import { CardInstallmentIntentPanel } from '../components/finance/CardInstallmentIntentPanel'
import { CardInstallmentExpensesPanel } from '../components/finance/CardInstallmentExpensesPanel'
import { RecentCardExpensesPanel } from '../components/finance/RecentCardExpensesPanel'
import type { Card, CardStatementArchive } from '../types/database'
import { buildStatementPaidMap, statementRemainingAmount } from '../utils/cardStatementPayments'
import { dateInputValue, formatDate } from '../utils/date'
import { cardPayableDebt } from '../utils/financeSummary'
import { minimumCardPaymentRate } from '../utils/financeObligationRules'
import { favoritesFirst } from '../utils/accountFavorites'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { lazyWithReload } from '../lib/lazyWithReload'
import { updateCardFavorite } from '../data/repositories/cardsRepo'
import { ProvisionPanel, StatementArchivePanel, StatementPanel } from './CardsPage.statements'
import {
  CardSectionNav,
  DueStatementAutomation,
  type CardSection,
} from './CardsPage.sections'
import { AccountListRow, CardsSummary, SharedLimitGroups, UpcomingInstallmentPlans, PeriodSpendingBreakdown } from './CardsPage.summary'

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

const StatementImportModal = lazyWithReload(() =>
  import('../components/finance/StatementImportModal').then((module) => ({
    default: module.StatementImportModal,
  })),
)

const CurrentMovementImportModal = lazyWithReload(() =>
  import('../components/finance/CurrentMovementImportModal').then((module) => ({
    default: module.CurrentMovementImportModal,
  })),
)

export function CardsPage() {
  const [taskParams, setTaskParams] = useSearchParams()
  const selectingTransfer = taskParams.get('task') === 'transfer'
  const { handleSectionChange, section, selectedCardId, openCardDetails, backToList, panel, openPanel } = useCardSectionNavigation()
  const { formatAmount, hidden: balancesHidden } = useBalancePrivacy()
  const {
    installments,
    installmentsLoading,
    installmentsError,
    invalidateSnapshot,
    loadInstallments,
    loadStatements,
    provisionActionId,
    provisionError,
    provisions,
    provisionsLoading,
    reconciliations,
    refreshCardsAndProvisions,
    statementActionId,
    statementError,
    statements,
    statementPayments,
    statementsLoading,
    handlePostAllProvisions,
    handleProvisionAction,
    handleSetProvisionInstallments,
    setStatementActionId,
  } = useCardsPageData({ section, panel, selectedCardId })
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
  // Hızlı harcama kaydı → "Son kart hareketleri" listesi tazelenir (B2).
  const [expensesVersion, setExpensesVersion] = useState(0)
  const [importCard, setImportCard] = useState<Card | null>(null)
  const [movementImportCard, setMovementImportCard] = useState<Card | null>(null)
  const [postImportBanner, setPostImportBanner] = useState(false)
  const handleImportSuccess = useCallback(async (setter: (v: null) => void) => {
    setter(null)
    await refreshCardsAndProvisions(reloadCards ?? (async () => {}))
    setPostImportBanner(true)
  }, [reloadCards, refreshCardsAndProvisions])

  async function openStatementPayment(statement: CardStatementArchive, card: Card, cards: Card[], reload: () => Promise<void>) {
    // Tutar = KALAN (kısmi ödemeler düşülmüş); çekmecede düzenlenebilir, asgari
    // ipucunun tabanı da aynı kalandır (K7).
    const remaining = statementRemainingAmount(statement, buildStatementPaidMap(statementPayments))
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
        amount: remaining,
        maxPayableAmount: remaining,
        minimumPaymentBase: remaining,
        minimumPaymentRate: minimumCardPaymentRate(card.credit_limit),
        direction: 'outflow',
      },
      {
        cards,
        reload,
        afterSuccess: async () => {
          await invalidateSnapshot()
        },
        detail: (
          <>
            <p className="font-semibold text-ink">{card.card_name}</p>
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
        minimumPaymentBase: card.statement_debt_amount,
        minimumPaymentRate: minimumCardPaymentRate(card.credit_limit),
        direction: 'outflow',
      },
      {
        cards,
        reload,
        afterSuccess: async () => {
          await invalidateSnapshot()
        },
        detail: (
          <>
            <p className="font-semibold text-ink">{card.card_name}</p>
            <p>Ekstre borcu: {formatAmount(card.statement_debt_amount)}</p>
            <p>Dönem içi harcama: {formatAmount(card.current_period_spending)}</p>
            <p>
              Ödenebilir toplam:{' '}
              <span className="font-mono font-semibold text-ink">{formatAmount(cardPayableDebt(card))}</span>
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

  async function toggleFavorite(card: Card, reload: () => Promise<void>, setError: (message: string) => void) {
    const result = await updateCardFavorite(card.id, !card.is_favorite)
    if (!result.ok) {
      setError(result.error.message ?? 'Favori tercihi kaydedilemedi.')
      return
    }
    await Promise.all([reload(), invalidateSnapshot()])
  }

  function renderPanels(cardRows: Card[], reload: () => Promise<void>, setError: (message: string) => void) {
    if (!panel) return null
    const scopedCards = selectedCardId ? cardRows.filter((row) => row.id === selectedCardId) : cardRows
    const scopedStatements = selectedCardId ? statements.filter((item) => item.card_id === selectedCardId) : statements
    const scopedInstallments = selectedCardId ? installments.filter((item) => item.card_id === selectedCardId) : installments
    const scopedProvisions = selectedCardId ? provisions.filter((item) => item.card_id === selectedCardId) : provisions
    const refresh = async () => {
      await refreshCardsAndProvisions(reload)
      setExpensesVersion((version) => version + 1)
    }
    return (
      <section id="kart-bilgi-dokumu" className={`flex scroll-mt-[calc(env(safe-area-inset-top)+6rem)] flex-col gap-3 ${panel === 'manuel' ? '' : 'border-t border-line pt-4'}`} aria-label={panel === 'manuel' ? 'Harcama girişi' : 'Seçilen bilgi dökümü'}>
        <div className="flex"><button type="button" onClick={() => openPanel(null)} aria-label={panel === 'manuel' ? 'Kapat' : undefined} className="interaction-press flex min-h-11 items-center gap-2 text-sm font-semibold text-primary">{panel === 'manuel' ? <><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />Hesaplara dön</> : 'Dökümü kapat'}</button></div>
        {panel === 'donem' ? <><PeriodSpendingBreakdown cards={scopedCards} /><CategoryCleanupPanel key={selectedCardId ?? 'all'} collapsible cardId={selectedCardId ?? undefined} refreshKey={expensesVersion} onChanged={() => { void invalidateSnapshot(); setExpensesVersion((version) => version + 1) }} /><RecentCardExpensesPanel key={selectedCardId ?? 'all'} cardId={selectedCardId ?? undefined} cards={cardRows} reload={refresh} setError={setError} refreshKey={expensesVersion} /></> : null}
        {panel === 'kategoriler' ? <CategoryCleanupPanel key={selectedCardId ?? 'all'} cardId={selectedCardId ?? undefined} onChanged={() => { void invalidateSnapshot(); setExpensesVersion((version) => version + 1) }} /> : null}
        {panel === 'manuel' ? <QuickExpensePanel rows={cardRows} reload={refresh} setError={setError} focus={selectedCardId ? { cardId: selectedCardId, mode: 'cash', nonce: 0 } : null} formatAmount={formatAmount} onSaved={() => setExpensesVersion((version) => version + 1)} /> : null}
        {panel === 'taksitler' ? (
          installmentsError ? <p role="alert" className="text-sm text-warning">{installmentsError} <button type="button" className="min-h-11 font-semibold underline" onClick={() => void loadInstallments()}>Tekrar dene</button></p> : <>
            <CardInstallmentCalendarPanel cards={scopedCards} installments={scopedInstallments} loading={installmentsLoading} />
            <UpcomingInstallmentPlans cards={scopedCards} installments={scopedInstallments} loading={installmentsLoading} />
            <DeferredDetails className="border-t border-line pt-2" summaryClassName="min-h-11 cursor-pointer py-3 text-sm font-semibold" summary="Taksitli alışveriş ayrıntılarını düzenle"><p className="mb-3 text-xs text-ink-muted">Son 50 taksitli alışveriş · tamamlananlar dahil. Gelecek taksitlerin tamamı yukarıdaki dökümde yer alır.</p><CardInstallmentExpensesPanel key={selectedCardId ?? 'all'} cardId={selectedCardId ?? undefined} cards={cardRows} reload={refresh} setError={setError} /></DeferredDetails>
          </>
        ) : null}
        {panel === 'ekstreler' ? <>
          {statementError ? <p role="alert" className="text-sm text-warning">{statementError} <button type="button" className="min-h-11 font-semibold underline" onClick={() => void loadStatements()}>Tekrar dene</button></p> : <StatementPanel rows={scopedCards} statements={scopedStatements} statementPayments={statementPayments} loading={statementsLoading} actionId={statementActionId} onPay={(statement, card) => openStatementPayment(statement, card, cardRows, reload)} />}
          {!statementError ? <StatementArchivePanel rows={scopedCards} statements={scopedStatements} /> : null}
        </> : null}
        {panel === 'provizyon' ? <>
          {provisionError ? <p role="alert" className="text-sm text-warning">{provisionError}</p> : null}
          <ProvisionPanel rows={scopedCards} provisions={scopedProvisions} installments={scopedInstallments} statements={scopedStatements} loading={provisionsLoading} actionId={provisionActionId}
            onPost={(expense) => void handleProvisionAction(expense, 'post', reload, setError)} onPostAll={(expenses) => void handlePostAllProvisions(expenses, reload, setError)} onCancel={(expense) => void handleProvisionAction(expense, 'cancel', reload, setError)} onSetInstallments={(expense, count) => void handleSetProvisionInstallments(expense, count, reload, setError)} onImportStatement={(card) => { setReloadCards(() => reload); setImportCard(card) }} />
          <DeferredDetails className="border-t border-line pt-2" summaryClassName="min-h-11 cursor-pointer py-3 text-sm font-semibold" summary="Yeni alışveriş için taksit bilgisi"><CardInstallmentIntentPanel cards={scopedCards} installments={scopedInstallments} onChanged={refresh} /></DeferredDetails>
        </> : null}
      </section>
    )
  }

  return (
    <>
      <CrudPage
        table="cards"
        pageTitle="Hesaplar ve kartlar"
        pageLabel="Finans merkezi"
        pageDescription="Banka, nakit, kredi kartı yükü, transfer ve günlük işlemleri tek karar düzeninde yönet."
        addLabel={section === 'hesaplar' ? 'Hesap ekle' : section === 'kartlar' ? 'Kredi kartı ekle' : 'Hesap / kart ekle'}
        fields={fields}
        emptyTitle={section === 'hesaplar' ? 'Henüz hesap veya nakit cüzdanı yok' : 'Henüz kredi kartı yok'}
        emptyDescription="Banka hesaplarını, nakit cüzdanlarını ve kredi kartlarını buradan takip edebilirsin."
        orderBy="card_type"
        showToolbar={!selectedCardId && !selectingTransfer}
        showList={panel !== 'manuel' || Boolean(selectedCardId)}
        listFilter={(row) => selectedCardId ? row.id === selectedCardId : row.card_type === (selectingTransfer || section === 'hesaplar' ? 'banka_karti' : 'kredi_karti')}
        sortRows={favoritesFirst}
        afterSave={async () => {
          await invalidateSnapshot()
        }}
        afterDelete={async () => {
          await invalidateSnapshot()
          if (selectedCardId) backToList()
        }}
        renderBeforeList={({ loading, rows, reload, setError }) => {
          const cardRows = rows as Card[]
          if (!loading && panel === 'manuel' && !selectedCardId) return <>
            {renderPanels(cardRows, reload, setError)}
            <DueStatementAutomation rows={cardRows} statements={statements} statementsLoading={statementsLoading || Boolean(statementError)} reload={async () => { await Promise.all([reload(), invalidateSnapshot()]) }} loadStatements={loadStatements} setError={setError} />
          </>
          const selected = cardRows.find((row) => row.id === selectedCardId)
          const counts: Partial<Record<CardSection, number>> = {
            kartlar: cardRows.filter((row) => row.card_type === 'kredi_karti').length,
            hesaplar: cardRows.filter((row) => row.card_type === 'banka_karti').length,
          }
          return (
            <div className="flex flex-col gap-3">
              {postImportBanner ? <div className="flex flex-wrap items-center gap-3 border-b border-line py-3 text-xs text-info"><ShieldCheck size={18} /><p className="flex-1">İçe aktarma tamamlandı.</p><Link to="/veri-sagligi" className="min-h-11 py-3 font-semibold" onClick={() => setPostImportBanner(false)}>Veri tutarlılığını kontrol et</Link><button type="button" className="min-h-11 px-2" onClick={() => setPostImportBanner(false)}>Kapat</button></div> : null}
              {selectedCardId ? <div className="flex items-center gap-3 border-b border-line pb-3"><button type="button" onClick={backToList} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft size={17} /> Listeye dön</button><h2 className="ml-auto text-sm font-semibold text-ink">{selected?.card_type === 'banka_karti' ? 'Hesap ayrıntıları' : 'Kart ayrıntıları'}</h2></div> : <CardSectionNav section={section} onSelect={handleSectionChange} counts={counts} />}
              {!loading && selectedCardId && !selected ? <p role="alert" className="py-5 text-sm text-ink-muted">Bu kayıt bulunamadı. Silinmiş olabilir; listeye dönerek başka bir kayıt seçebilirsin.</p> : null}
              {selectingTransfer ? <div className="border-b border-line py-3"><h2 className="text-base font-semibold">Transfer için kaynak hesap seç</h2><p className="mt-1 text-sm text-ink-muted">Paranın çıkacağı hesabı seç; tutarı ve hedef hesabı sonraki adımda belirle.</p><button type="button" className="min-h-11 text-sm text-primary" onClick={() => { const next = new URLSearchParams(taskParams); next.delete('task'); setTaskParams(next, { replace: true }) }}>Vazgeç</button></div> : null}
              {!loading && !selectedCardId && !selectingTransfer ? <>
                <CardsSummary rows={cardRows} installments={installments} statements={statements} statementPayments={statementPayments} installmentsLoading={installmentsLoading} installmentsError={installmentsError} statementsLoading={statementsLoading} statementError={statementError} section={section === 'hesaplar' ? 'hesaplar' : 'kartlar'} panel={panel} onOpenPanel={openPanel} />
                {section === 'kartlar' ? renderPanels(cardRows, reload, setError) : null}
              </> : null}
              {!loading ? <DueStatementAutomation rows={cardRows} statements={statements} statementsLoading={statementsLoading || Boolean(statementError)} reload={async () => { await Promise.all([reload(), invalidateSnapshot()]) }} loadStatements={loadStatements} setError={setError} /> : null}
            </div>
          )
        }}
        renderAfterList={({ loading, rows }) => !loading && !selectedCardId && section === 'kartlar' && panel !== 'manuel' ? <><DeferredDetails defaultOpen={taskParams.get('cycle') === '1'} className="border-t border-line pt-1" summaryClassName="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-muted" summary="Kart ödeme döngüsü"><CardsPaymentCycle /></DeferredDetails><DeferredDetails className="border-t border-line pt-1" summaryClassName="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-muted" summary="Ortak limitleri yönet"><SharedLimitGroups rows={rows as Card[]} onOpenCard={openCardDetails} /></DeferredDetails></> : null}
        getInitialValues={(row) => ({ ...getCardInitialValues(row), ...(!row && section === 'hesaplar' ? { entry_type: 'banka_karti' } : {}) })}
        mapForm={mapCardForm}
        renderTitle={renderCardTitle}
        renderSubtitle={renderCardSubtitle}
        renderDetails={renderCardDetails}
        renderCard={(row, helpers) => selectedCardId ? (
          <div className="flex flex-col gap-5">
            <CreditAccountListCard row={row as Card} rows={helpers.rows as Card[]} statements={statements} statementPayments={statementPayments} installments={installments} reconciliations={reconciliations} menu={helpers.menu} rowActions={helpers.rowActions} ledgerOpen detailsOpen installmentsKnown={!installmentsLoading && !installmentsError} statementsKnown={!statementsLoading && !statementError} balancesHidden={balancesHidden} formatAmount={formatAmount}
              onPayDebt={(card) => void openDebtPayment(card, helpers.rows as Card[], helpers.reload)} onOpenPanel={openPanel} onToggleFavorite={(card) => void toggleFavorite(card, helpers.reload, helpers.setError)} onChanged={() => refreshCardsAndProvisions(helpers.reload)} />
            {row.card_type === 'kredi_karti' ? <>
              <nav className="grid grid-cols-2 gap-2" aria-label="Kart dökümleri">
                {([
                  ['donem', 'Son hareketler ve dönem özeti', List],
                  ['taksitler', 'Gelecek taksitler', CalendarClock],
                  ['ekstreler', 'Ekstre dökümü', FileText],
                  ['provizyon', 'Provizyonlar', Clock],
                ] as const).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => openPanel(id)} aria-expanded={panel === id} aria-controls="kart-bilgi-dokumu" className={`flex min-h-16 min-w-0 items-center gap-2 rounded-xl border p-3 text-left text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${panel === id ? 'border-primary bg-primary/10 text-primary' : 'border-line-strong bg-raised text-ink hover:border-primary/50'}`}><Icon size={18} className="shrink-0 text-primary" aria-hidden="true" /><span className="flex-1 break-words">{label}</span><ChevronRight size={14} className="shrink-0 text-ink-muted" aria-hidden="true" /></button>)}
              </nav>
              {renderPanels(helpers.rows as Card[], helpers.reload, helpers.setError)}
            </> : null}
          </div>
        ) : <AccountListRow actionLabel={selectingTransfer ? `${row.card_name} hesabından transfer` : undefined} card={row as Card} statements={statements} statementPayments={statementPayments} statementsKnown={!statementsLoading && !statementError} onOpen={(card) => {
          if (!selectingTransfer) return openCardDetails(card)
          openTransaction(card, helpers.reload, helpers.rows as Card[], 'transfer')
          const next = new URLSearchParams(taskParams)
          next.delete('task')
          setTaskParams(next, { replace: true })
        }} />}
        getCardClassName={getCardClassName}
        getDetailClassName={getDetailClassName}
        getCardStyle={getCardStyle}
        getDetailStyle={getDetailStyle}
        listGridClassName="flex flex-col"
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
                    setReloadCards(() => menuHelpers.reload)
                    setImportCard(card)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                >
                  <FileText size={14} />
                  Ekstre içe aktar
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    menuHelpers.closeMenu()
                    setReloadCards(() => menuHelpers.reload)
                    setMovementImportCard(card)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                >
                  <ScanSearch size={14} />
                  Hareketleri karşılaştır
                </button>
              </>
            )
          }
          return null
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
        <Suspense fallback={<ImportModalFallback />}>
          <StatementImportModal
            card={importCard}
            onClose={() => setImportCard(null)}
            onSuccess={() => void handleImportSuccess(setImportCard)}
          />
        </Suspense>
      )}

      {movementImportCard && (
        <Suspense fallback={<ImportModalFallback />}>
          <CurrentMovementImportModal
            card={movementImportCard}
            onClose={() => setMovementImportCard(null)}
            onSuccess={() => void handleImportSuccess(setMovementImportCard)}
          />
        </Suspense>
      )}

      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}

function ImportModalFallback() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4 backdrop-blur-sm">
      <div role="status" aria-live="polite" className="rounded-2xl border border-line-strong bg-raised px-5 py-4 text-sm font-semibold text-ink">
        İçe aktarma aracı hazırlanıyor...
      </div>
    </div>
  )
}
