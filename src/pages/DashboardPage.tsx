/**
 * `/` ana sayfa orkestratörü. Görevi: veriyi tek snapshot'tan çekmek, saf
 * util'lere hesaplatmak ve sonucu panel bileşenlerine dağıtmak. Burada AĞIR
 * İŞ KURALI/MATEMATİK YAZMA — yeni hesap gerekiyorsa `src/utils/*`'a koy, buradan
 * çağır (bilanço/akış/sağlık için financeSummary.ts, yaklaşanlar için
 * dashboardUpcoming.ts, içgörü için dashboardInsights.ts...).
 *
 * Veri kaynağı: `useFinanceSnapshot` (TanStack Query). AYNI cache'i AnalysisPage
 * de paylaşır; bu sayfa süperseti kendi penceresine client-side daraltır.
 *
 * Hesap ownership tablosu ve UX/a11y sözleşmesi: docs/DASHBOARD_ARCHITECTURE.md
 * (yeni panel/hesap eklemeden önce oraya bak).
 */
import { AlertTriangle, ChevronDown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFinanceSnapshot, useInvalidateFinanceSnapshot } from '../app/useFinanceSnapshot'
import type {
  AccountReconciliation,
  Asset,
  Budget,
  Card as FinanceCard,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  CardStatementPayment,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
  TransactionHistory,
} from '../types/database'
import { HistorySection } from '../components/dashboard/DashboardCards'
import { FocusActionPanel } from '../components/dashboard/DashboardInsights'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import type { FinanceObligation } from '../utils/obligations'
import { StatementReminderPanel } from '../components/dashboard/StatementReminderPanel'
import { ReconciliationPanel } from '../components/dashboard/ReconciliationPanel'
import { Divider } from '../components/serit'
import { SeritOverview, type SeritLiquidAccount } from '../components/dashboard/SeritOverview'
import { buildMonthStrip, monthStripTone } from '../utils/dashboardMonthStrip'
import { useSafeToSpend } from '../hooks/useSafeToSpend'
import { useMarketRates } from '../hooks/useMarketRates'
import { formatSnapshotAge } from '../utils/marketRates'
import { addMonths, dateInputValue, endOfMonth, startOfMonth } from '../utils/date'
import {
  buildFinancialPosition,
  buildMonthlyCashFlow,
  totalCreditLimit,
} from '../utils/financeSummary'
import { buildAttentionLine } from '../utils/attention'
import { buildHealthCounts } from '../utils/dataHealthSummary'
import { buildFocusActions } from '../utils/dashboardInsights'
import { buildDashboardUpcomingItems } from '../utils/dashboardUpcoming'
import { buildStatementReminders } from '../utils/statementReminder'
import { SkeletonDashboard } from '../components/ui/skeleton'

type DashboardData = {
  assets: Asset[]
  cards: FinanceCard[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  transactionHistory: TransactionHistory[]
  budgets: Budget[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  cardStatements: CardStatementArchive[]
  cardStatementPayments: CardStatementPayment[]
  savingsGoals: SavingsGoal[]
  savingsGoalComponents: SavingsGoalComponent[]
  accountReconciliations: AccountReconciliation[]
}

const emptyData: DashboardData = {
  assets: [],
  cards: [],
  loans: [],
  loanInstallments: [],
  debts: [],
  payments: [],
  salaryHistory: [],
  transactionHistory: [],
  budgets: [],
  cardExpenses: [],
  cardInstallments: [],
  cardStatements: [],
  cardStatementPayments: [],
  savingsGoals: [],
  savingsGoalComponents: [],
  accountReconciliations: [],
}

const UPCOMING_DAYS = 30
const DASHBOARD_HISTORY_MONTHS = 3
const DASHBOARD_SPENDING_MONTHS = 4

export function DashboardPage() {
  const snapshotQuery = useFinanceSnapshot()
  // Dikkat bandı tutarı metin içinde taşır; gizlilik modunda maskelenmeli (K1).
  const { maskText } = useBalancePrivacy()

  // Snapshot yıllık raporlar için geniş bir süperset taşır; dashboard daraltır.
  // (geçmiş 3 ay, harcamalar 4 ay, bütçe yalnızca içinde bulunulan ay).
  const data: DashboardData = useMemo(() => {
    const snapshot = snapshotQuery.data
    if (!snapshot) return emptyData

    const currentMonthStart = startOfMonth()
    const historyStart = addMonths(currentMonthStart, -DASHBOARD_HISTORY_MONTHS).getTime()
    const spendingStart = dateInputValue(addMonths(currentMonthStart, -DASHBOARD_SPENDING_MONTHS))
    const currentMonth = dateInputValue(currentMonthStart)

    return {
      assets: snapshot.assets,
      cards: snapshot.cards,
      loans: snapshot.loans,
      loanInstallments: snapshot.loanInstallments,
      debts: snapshot.debts,
      payments: snapshot.payments,
      salaryHistory: snapshot.salaryHistory,
      transactionHistory: snapshot.transactionHistory.filter((row) => new Date(row.occurred_at).getTime() >= historyStart),
      budgets: snapshot.budgets.filter((budget) => budget.month === currentMonth),
      cardExpenses: snapshot.cardExpenses.filter((expense) => expense.spent_at >= spendingStart),
      cardInstallments: snapshot.cardInstallments,
      cardStatements: snapshot.cardStatements,
      cardStatementPayments: snapshot.cardStatementPayments,
      savingsGoals: snapshot.savingsGoals,
      savingsGoalComponents: snapshot.savingsGoalComponents,
      accountReconciliations: snapshot.accountReconciliations,
    }
  }, [snapshotQuery.data])

  const loading = snapshotQuery.isPending
  const error = snapshotQuery.error instanceof Error ? snapshotQuery.error.message : ''

  const obligationInput = useMemo(() => ({
    cards: data.cards,
    payments: data.payments,
    loans: data.loans,
    loanInstallments: data.loanInstallments,
    debts: data.debts,
    cardInstallments: data.cardInstallments,
    cardStatements: data.cardStatements,
    cardStatementPayments: data.cardStatementPayments,
    salaryHistory: data.salaryHistory,
    accountReconciliations: data.accountReconciliations,
  }), [data.accountReconciliations, data.cardInstallments, data.cardStatementPayments, data.cardStatements, data.cards, data.debts, data.loanInstallments, data.loans, data.payments, data.salaryHistory])

  const summary = useMemo(() => {
    const position = buildFinancialPosition(data)
    const totalSharedCreditLimit = totalCreditLimit(data.cards)
    const creditUsageRate = totalSharedCreditLimit > 0 ? Math.min(100, (position.totalCreditCardDebt / totalSharedCreditLimit) * 100) : 0
    const cashFlow = buildMonthlyCashFlow(data)

    return {
      ...position,
      totalCreditLimit: totalSharedCreditLimit,
      creditUsageRate,
      cashFlow,
    }
  }, [data])

  const upcomingItems = useMemo(() => {
    return buildDashboardUpcomingItems(obligationInput, UPCOMING_DAYS)
  }, [obligationInput])
  const outflowUpcoming = useMemo(() => upcomingItems.filter((item) => item.direction === 'outflow'), [upcomingItems])

  const focusActions = useMemo(
    () => buildFocusActions(data, summary.cashFlow, summary.creditUsageRate, outflowUpcoming),
    [data, summary.cashFlow, summary.creditUsageRate, outflowUpcoming],
  )
  const attentionLine = useMemo(() => buildAttentionLine(data, outflowUpcoming), [data, outflowUpcoming])

  // Şerit'teki yaklaşan vadeler yerinde ödensin: paylaşılan çekmece
  // (PaymentsPage/LoansPage ile aynı) sayfa değiştirmeden açılır, ödeme sonrası
  // snapshot cache'i tazelenir.
  const invalidateSnapshot = useInvalidateFinanceSnapshot()
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()
  const handleUpcomingPay = useCallback(
    (obligation: FinanceObligation) => {
      void openPaymentDrawer(obligation, {
        cards: data.cards,
        reload: async () => {
          await invalidateSnapshot()
        },
      })
    },
    [openPaymentDrawer, data.cards, invalidateSnapshot],
  )
  const healthCounts = useMemo(() => buildHealthCounts(data), [data])

  // ── Şerit katmanı (yeni görsel dil, `2a`/`4e`) ──
  // Kahraman rakam SafeToSpendCard'ın hesabıdır; kart kaldırıldığı için hesap
  // ortak hook'a taşındı. Buradaki tek yeni türev ay şeridi.
  const safeToSpend = useSafeToSpend(summary.cashFlow, summary.totalCashAssets)
  // Net değerin içinde altın/döviz var; kur bayatsa rakam da bayattır. Uyarı
  // Varlıklar/Borçlar/Altın'daki RatesBanner'da vardı ama kahraman rakamın
  // olduğu ekranda hiç yoktu (Faz D3).
  const { snapshot: ratesSnapshot, isStale: ratesStale } = useMarketRates()
  const staleRatesLabel = ratesStale ? formatSnapshotAge(ratesSnapshot) : null
  const monthStrip = useMemo(
    () =>
      buildMonthStrip(
        upcomingItems.map((item) => ({
          id: item.id,
          title: item.title,
          amount: item.amount,
          sortTime: item.sortTime,
          tone: monthStripTone(item.obligation.kind),
        })),
      ),
    [upcomingItems],
  )
  const sortedUpcoming = useMemo(
    () => [...upcomingItems].sort((a, b) => a.sortTime - b.sortTime),
    [upcomingItems],
  )
  const liquidAccounts = useMemo<SeritLiquidAccount[]>(
    () => [
      ...data.cards
        .filter((card) => card.card_type === 'banka_karti')
        .map((card) => ({
          id: card.id,
          name: `${card.bank_name} · ${card.card_name}`,
          amount: card.current_balance,
        })),
      ...data.assets
        .filter((asset) => asset.category === 'Nakit')
        .map((asset) => ({ id: asset.id, name: asset.name, subtitle: 'Nakit', amount: asset.estimated_value_try })),
    ],
    [data.cards, data.assets],
  )
  // Hiç finansal kayıt yok mu? Kahraman rakam ve odak kutusu AYNI karara bakar;
  // ayrı ayrı hesaplandığında hero "veri yok" derken kutu tamponun eksisini
  // (−5.000 ₺) göstermeye devam ediyordu (canlı tur, denetim §10).
  const isOnboarding = useMemo(
    () =>
      summary.totalAssets <= 0
      && summary.totalDebts <= 0
      && summary.totalCreditCardDebt <= 0
      && liquidAccounts.length === 0
      && sortedUpcoming.length === 0,
    [liquidAccounts.length, sortedUpcoming.length, summary.totalAssets, summary.totalCreditCardDebt, summary.totalDebts],
  )
  // "Bugün" donuk kalmasın: PWA sekmesi gece boyunca açık kaldığında
  // `useMemo(..., [])` dünün tarihini gösteriyordu (gün sayacı, kalan gün,
  // günlük harcanabilir hepsi bir gün geride kalıyordu). Sekme öne geldiğinde
  // yerel gün değiştiyse yeniden hesaplanır.
  const [todayStamp, setTodayStamp] = useState(() => dateInputValue(new Date()))
  useEffect(() => {
    const syncToday = () => {
      if (document.visibilityState === 'hidden') return
      const next = dateInputValue(new Date())
      setTodayStamp((current) => (current === next ? current : next))
    }
    document.addEventListener('visibilitychange', syncToday)
    window.addEventListener('focus', syncToday)
    return () => {
      document.removeEventListener('visibilitychange', syncToday)
      window.removeEventListener('focus', syncToday)
    }
  }, [])
  const monthMeta = useMemo(() => {
    const today = new Date(`${todayStamp}T00:00:00`)
    const daysInMonth = endOfMonth(today).getDate()
    const daysLeft = Math.max(1, daysInMonth - today.getDate())
    return { today, daysInMonth, daysLeft }
  }, [todayStamp])
  const hasStatementReminders = useMemo(
    () => buildStatementReminders(data.cards, data.cardStatements).length > 0,
    [data.cards, data.cardStatements],
  )

  const [showDetails, setShowDetails] = useState(() => {
    try { return localStorage.getItem('dashboard-details') === '1' } catch { return false }
  })

  const toggleDetails = useCallback(() => {
    setShowDetails((prev) => {
      const next = !prev
      try { localStorage.setItem('dashboard-details', next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }, [])

  if (loading) {
    return <SkeletonDashboard />
  }

  if (error) {
    return (
      <section
        role="alert"
        aria-live="assertive"
        className="rounded-2xl border border-destructive/20 bg-destructive/8 p-4 text-sm text-destructive"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="font-black text-destructive">Dashboard verileri yüklenemedi</h2>
              <p className="mt-1 leading-6 text-destructive/85">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void snapshotQuery.refetch()}
            disabled={snapshotQuery.isFetching}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/25 bg-raised px-4 text-sm font-black text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${snapshotQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {snapshotQuery.isFetching ? 'Yenileniyor' : 'Tekrar dene'}
          </button>
        </div>
      </section>
    )
  }

  const detailsPanelId = 'dashboard-details-panel'

  return (
    <section className="grid gap-6 lg:grid-cols-12 lg:items-start">
      {/* ── Şerit katmanı: ekranın cevapladığı tek soru ve onu açan çizgiler ── */}

      {attentionLine ? (
        <div className="dashboard-item min-w-0 lg:col-span-12" style={{ '--di': 0 } as React.CSSProperties}>
          <p
            role="status"
            className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] font-semibold"
            style={{
              color: attentionLine.tone === 'danger' ? 'var(--destructive)' : 'var(--warning)',
              background:
                attentionLine.tone === 'danger'
                  ? 'color-mix(in srgb, var(--destructive) 9%, transparent)'
                  : 'color-mix(in srgb, var(--warning) 9%, transparent)',
            }}
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{maskText(attentionLine.text)}</span>
          </p>
        </div>
      ) : null}

      <div className="dashboard-item min-w-0 lg:col-span-12" style={{ '--di': 1 } as React.CSSProperties}>
        <SeritOverview
          monthLabel={summary.cashFlow.monthLabel}
          today={monthMeta.today}
          daysInMonth={monthMeta.daysInMonth}
          safeToSpend={safeToSpend}
          reservedKnown={safeToSpend.reservedKnown}
          isOnboarding={isOnboarding}
          buffer={safeToSpend.buffer}
          onBufferChange={safeToSpend.setBuffer}
          perDayAllowance={Math.max(0, safeToSpend.amount) / monthMeta.daysLeft}
          strip={monthStrip}
          upcoming={sortedUpcoming}
          cardBuckets={{
            statement: summary.totalCardStatementDebt,
            current: summary.totalCardCurrentPeriod,
            provision: summary.totalCardProvision,
            total: summary.totalCreditCardDebt,
          }}
          creditUsageRate={summary.creditUsageRate}
          totalCreditLimit={summary.totalCreditLimit}
          netWorth={summary.netWorth}
          totalAssets={summary.totalAssets}
          totalDebts={summary.totalDebts}
          staleRatesLabel={staleRatesLabel}
          liquidAccounts={liquidAccounts}
          totalCashAssets={summary.totalCashAssets}
          health={healthCounts}
          onPay={(item) => handleUpcomingPay(item.obligation)}
        />
      </div>

      {/* ── Detay toggle ──
          Aşağısı henüz eski dilde. Şerit'e çevrilmemiş paneller (odak aksiyonları,
          ekstre hatırlatıcısı, mutabakat, geçmiş) buraya indirildi; ilgili ekranlar
          dönüştükçe bu katman eriyecek. */}

      <div className="dashboard-item min-w-0 lg:col-span-12" style={{ '--di': 2 } as React.CSSProperties}>
        <button
          type="button"
          onClick={toggleDetails}
          aria-expanded={showDetails}
          aria-controls={detailsPanelId}
          className="group flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised px-4 py-3 text-sm font-bold text-ink-muted transition hover:border-primary/30 hover:bg-primary/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <span>{showDetails ? 'Detayları gizle' : 'Tüm detayları göster'}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-200 ${showDetails ? 'rotate-180' : 'group-hover:translate-y-0.5'}`}
          />
        </button>
      </div>

      {/* ── Detay katmanı (toggle ile açılır) ── */}

      <div
        id={detailsPanelId}
        className={`dashboard-details-wrapper lg:col-span-12 ${showDetails ? 'dashboard-details-open' : ''}`}
      >
        <div className="grid min-w-0 gap-5 lg:grid-cols-12 lg:items-start">
          {/* ─ Odak ve hatırlatıcılar ─ */}
          <div className="min-w-0 lg:col-span-12">
            <FocusActionPanel actions={focusActions} safeToSpendAmount={safeToSpend.amount} onboarding={isOnboarding} />
          </div>

          {hasStatementReminders ? (
            <div className="min-w-0 lg:col-span-12">
              <StatementReminderPanel cards={data.cards} statements={data.cardStatements} />
            </div>
          ) : null}

          {/* ─ Mutabakat ─ */}
          <DetailSectionDivider label="Mutabakat" />

          <div className="min-w-0 lg:col-span-12">
            <ReconciliationPanel cards={data.cards} statements={data.cardStatements.filter((statement) => statement.status === 'open')} />
          </div>

          {/* ─ Geçmiş ─ */}
          <DetailSectionDivider label="Geçmiş işlemler" />

          <div className="min-w-0 lg:col-span-12">
            <HistorySection rows={data.transactionHistory} />
          </div>
        </div>
      </div>
      <FinancePaymentDrawer {...drawerProps} />
    </section>
  )
}

function DetailSectionDivider({ label }: { label: string }) {
  // Elle yazılmış hâli serit/Divider ile birebir aynı işi yapıyordu.
  return <Divider label={label} space="none" className="lg:col-span-12" />
}
