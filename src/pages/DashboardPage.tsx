import { AlertTriangle, ArrowUpRight, CalendarDays, ChevronDown, CreditCard, Landmark, RefreshCw } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useFinanceSnapshot } from '../app/useFinanceSnapshot'
import type {
  AccountReconciliation,
  Asset,
  Budget,
  Card as FinanceCard,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
  TransactionHistory,
} from '../types/database'
import { BudgetAlertPanel } from '../components/dashboard/BudgetAlertPanel'
import {
  DashboardHero,
  DataHealthBadge,
  GoalProgressCommand,
  MetricTile,
  PulseCard,
  SalaryPulse,
} from '../components/dashboard/DashboardPanels'
import {
  AnalyticsSnapshotPanel,
  CreditCardSnapshotPanel,
  CreditLimitSection,
  CurrentDebtTotalsPanel,
  HistorySection,
} from '../components/dashboard/DashboardCards'
import {
  CashFlowCalendarPanel,
  CashFlowPanel,
  MonthlyPaymentLoadPanel,
} from '../components/dashboard/DashboardCashFlow'
import {
  FocusActionPanel,
  SmartInsightsPanel,
  SpendingRadarPanel,
  UpcomingAlertPanel,
} from '../components/dashboard/DashboardInsights'
import { dashboardHelp, getUserDisplayName } from '../components/dashboard/dashboardPanelUtils'
import { StatementReminderPanel } from '../components/dashboard/StatementReminderPanel'
import { ReconciliationPanel } from '../components/dashboard/ReconciliationPanel'
import { addMonths, dateInputValue, daysUntil, startOfMonth } from '../utils/date'
import {
  buildCreditLimitGroups,
  buildFinancialHealth,
  buildFinancialPosition,
  buildGoalProgressSummary,
  buildMonthlyCashFlow,
  getSalaryTrend,
  sum,
  totalCreditLimit,
} from '../utils/financeSummary'
import { buildAttentionLine } from '../utils/attention'
import { buildBudgetAlerts } from '../utils/budgetAlerts'
import { buildHealthCounts } from '../utils/dataHealthSummary'
import { buildSmartInsights, buildFocusActions, reconciliationDriftCount } from '../utils/dashboardInsights'
import { buildDashboardMonthlyLoad, buildDashboardUpcomingItems } from '../utils/dashboardUpcoming'
import { formatCurrency } from '../utils/formatCurrency'
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
  savingsGoals: [],
  savingsGoalComponents: [],
  accountReconciliations: [],
}

const UPCOMING_DAYS = 30
const DASHBOARD_HISTORY_MONTHS = 3
const DASHBOARD_SPENDING_MONTHS = 4

const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
}
const fadeUp: Variants = {
  hidden:  { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
}
const noMotion: Variants = {
  hidden:  { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
}

export function DashboardPage() {
  const { user } = useAuth()
  const snapshotQuery = useFinanceSnapshot()
  const displayName = useMemo(() => getUserDisplayName(user), [user])
  const prefersReduced = useReducedMotion()

  // Snapshot 6 aylık süperset taşır; dashboard kendi dar penceresine indirger
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
    salaryHistory: data.salaryHistory,
    accountReconciliations: data.accountReconciliations,
  }), [data.accountReconciliations, data.cardInstallments, data.cardStatements, data.cards, data.debts, data.loanInstallments, data.loans, data.payments, data.salaryHistory])

  const summary = useMemo(() => {
    const position = buildFinancialPosition(data)
    const totalSharedCreditLimit = totalCreditLimit(data.cards)
    const totalLoanMonthlyPayment = sum(
      data.loans.filter((loan) => loan.status === 'active'),
      (loan) => loan.monthly_payment,
    )
    const creditUsageRate = totalSharedCreditLimit > 0 ? Math.min(100, (position.totalCreditCardDebt / totalSharedCreditLimit) * 100) : 0
    const salaryTrend = getSalaryTrend(data.salaryHistory)
    const creditLimitGroups = buildCreditLimitGroups(data.cards)
    const cashFlow = buildMonthlyCashFlow(data)
    const nextMonthCashFlow = buildMonthlyCashFlow(data, addMonths(startOfMonth(), 1))
    const nextMonthLoad = buildDashboardMonthlyLoad(obligationInput, addMonths(startOfMonth(), 1), startOfMonth())
    const goalProgress = buildGoalProgressSummary(data.savingsGoals, data.savingsGoalComponents)

    return {
      ...position,
      totalCreditLimit: totalSharedCreditLimit,
      creditUsageRate,
      creditLimitGroups,
      totalLoanMonthlyPayment,
      salaryTrend,
      cashFlow,
      nextMonthCashFlow,
      nextMonthLoad,
      goalProgress,
    }
  }, [data, obligationInput])

  const upcomingItems = useMemo(() => {
    return buildDashboardUpcomingItems(obligationInput, UPCOMING_DAYS)
  }, [obligationInput])
  const outflowUpcoming = useMemo(() => upcomingItems.filter((item) => item.direction === 'outflow'), [upcomingItems])

  const financialHealth = useMemo(() => {
    const urgentUpcomingCount = outflowUpcoming.filter((item) => {
      const remaining = daysUntil(new Date(item.sortTime))
      return remaining !== null && remaining >= 0 && remaining <= 7
    }).length

    return buildFinancialHealth({
      position: summary,
      cashFlow: summary.cashFlow,
      creditUsageRate: summary.creditUsageRate,
      urgentUpcomingCount,
      averageGoalProgress: summary.goalProgress.averageProgress,
    })
  }, [summary, outflowUpcoming])

  const reconDriftCount = useMemo(
    () => reconciliationDriftCount(data.cards, data.accountReconciliations),
    [data.cards, data.accountReconciliations],
  )
  const insights = useMemo(
    () => buildSmartInsights(summary.cashFlow, summary.creditUsageRate, summary.totalDebts, summary.totalReceivables, outflowUpcoming, reconDriftCount),
    [summary.cashFlow, summary.creditUsageRate, summary.totalDebts, summary.totalReceivables, outflowUpcoming, reconDriftCount],
  )
  const focusActions = useMemo(
    () => buildFocusActions(data, summary.cashFlow, summary.creditUsageRate, outflowUpcoming),
    [data, summary.cashFlow, summary.creditUsageRate, outflowUpcoming],
  )
  const attentionLine = useMemo(() => buildAttentionLine(data, outflowUpcoming), [data, outflowUpcoming])
  const healthCounts = useMemo(() => buildHealthCounts(data), [data])
  const hasStatementReminders = useMemo(
    () => buildStatementReminders(data.cards, data.cardStatements).length > 0,
    [data.cards, data.cardStatements],
  )
  const hasBudgetAlerts = useMemo(
    () => buildBudgetAlerts(data.budgets, data.cardExpenses).length > 0,
    [data.budgets, data.cardExpenses],
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
        className="rounded-2xl border border-destructive/20 bg-destructive/8 p-4 text-sm text-destructive shadow-[var(--shadow-card)]"
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
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-destructive/25 bg-card px-4 text-sm font-black text-destructive transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`size-4 ${snapshotQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {snapshotQuery.isFetching ? 'Yenileniyor' : 'Tekrar dene'}
          </button>
        </div>
      </section>
    )
  }

  const hasCreditLimitGroups = summary.creditLimitGroups.length > 0
  const hasCompanionPanels = hasStatementReminders || hasBudgetAlerts
  const upcomingTotal = sum(outflowUpcoming, (item) => item.amount)
  const itemVariant = prefersReduced ? noMotion : fadeUp
  const detailsPanelId = 'dashboard-details-panel'

  return (
    <motion.section
      variants={prefersReduced ? noMotion : stagger}
      initial="hidden"
      animate="visible"
      className="grid gap-5 lg:grid-cols-12 lg:items-start"
    >
      {/* ── Günlük katman (her zaman görünür) ── */}

      {attentionLine ? (
        <motion.div variants={itemVariant} className="min-w-0 lg:col-span-12">
          <p
            role="status"
            className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold ring-1 ${
              attentionLine.tone === 'danger'
                ? 'bg-destructive/8 text-destructive ring-destructive/25'
                : 'bg-warning/8 text-warning ring-warning/25'
            }`}
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{attentionLine.text}</span>
          </p>
        </motion.div>
      ) : null}

      <motion.div variants={itemVariant} className="min-w-0 lg:col-span-12">
        <DataHealthBadge errors={healthCounts.errors} warnings={healthCounts.warnings} total={healthCounts.total} />
      </motion.div>

      <motion.div variants={itemVariant} className="min-w-0 lg:col-span-8">
        <DashboardHero
          displayName={displayName}
          netWorth={summary.netWorth}
          totalAssets={summary.totalAssets}
          totalDebts={summary.totalDebts}
          totalReceivables={summary.totalReceivables}
          cashFlow={summary.cashFlow}
          health={financialHealth}
        />
      </motion.div>

      <motion.div variants={itemVariant} className="min-w-0 lg:col-span-4">
        <MonthlyPaymentLoadPanel
          cashFlow={summary.cashFlow}
          nextMonthOutflow={summary.nextMonthCashFlow.outflow}
          upcomingTotal={upcomingTotal}
          upcomingCount={outflowUpcoming.length}
        />
      </motion.div>

      <motion.div variants={itemVariant} className="min-w-0 lg:col-span-5">
        <CreditCardSnapshotPanel
          cards={data.cards}
          totalDebt={summary.totalCreditCardDebt}
          statementDebt={summary.totalCardStatementDebt}
          totalLimit={summary.totalCreditLimit}
          usageRate={summary.creditUsageRate}
        />
      </motion.div>

      <motion.div variants={itemVariant} className="min-w-0 lg:col-span-7">
        <FocusActionPanel actions={focusActions} cashFlow={summary.cashFlow} />
      </motion.div>

      {hasCompanionPanels ? (
        <motion.div
          variants={itemVariant}
          className={`grid min-w-0 gap-3 lg:col-span-12 ${
            hasStatementReminders && hasBudgetAlerts ? 'min-[760px]:grid-cols-2' : ''
          }`}
        >
          {hasStatementReminders ? <StatementReminderPanel cards={data.cards} statements={data.cardStatements} /> : null}
          {hasBudgetAlerts ? <BudgetAlertPanel budgets={data.budgets} expenses={data.cardExpenses} /> : null}
        </motion.div>
      ) : null}

      {/* ── Detay toggle ── */}

      <motion.div variants={itemVariant} className="min-w-0 lg:col-span-12">
        <button
          type="button"
          onClick={toggleDetails}
          aria-expanded={showDetails}
          aria-controls={detailsPanelId}
          className="group flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/80 px-4 py-3 text-sm font-bold text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <span>{showDetails ? 'Detayları gizle' : 'Tüm detayları göster'}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform duration-200 ${showDetails ? 'rotate-180' : 'group-hover:translate-y-0.5'}`}
          />
        </button>
      </motion.div>

      {/* ── Detay katmanı (toggle ile açılır) ── */}

      <AnimatePresence initial={false}>
        {showDetails ? (
          <motion.div
            key="dashboard-details"
            id={detailsPanelId}
            initial={prefersReduced ? false : { opacity: 0, height: 0 }}
            animate={prefersReduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={prefersReduced ? { opacity: 1 } : { opacity: 0, height: 0 }}
            transition={prefersReduced ? { duration: 0 } : { duration: 0.3, ease: 'easeInOut' }}
            className="grid min-w-0 gap-5 overflow-hidden lg:col-span-12 lg:grid-cols-12 lg:items-start"
          >
            {/* ─ Nakit akışı bölümü ─ */}
            <DetailSectionDivider label="Nakit akışı" />

            <div className="min-w-0 lg:col-span-7">
              <CashFlowCalendarPanel items={upcomingItems} cashFlow={summary.cashFlow} />
            </div>

            <div className="min-w-0 lg:col-span-5">
              <CashFlowPanel cashFlow={summary.cashFlow} />
            </div>

            {/* ─ Borç & tahsilat bölümü ─ */}
            <DetailSectionDivider label="Borçlar ve tahsilat" />

            <div className="min-w-0 lg:col-span-8">
              <CurrentDebtTotalsPanel
                totalDebt={summary.totalDebts}
                cardDebt={summary.totalCreditCardDebt}
                loanDebt={summary.totalLoanDebt}
                personalDebt={summary.totalPersonalDebts}
                paymentDebt={summary.totalPaymentLiabilities}
              />
            </div>

            <div className="grid min-w-0 gap-3 lg:col-span-4">
              <MetricTile label="Tahsilat" value={formatCurrency(summary.totalReceivables)} icon={<ArrowUpRight />} tone="emerald" help={dashboardHelp.receivable} />
            </div>

            {/* ─ Analiz bölümü ─ */}
            <DetailSectionDivider label="Analiz ve öneriler" />

            <div className="min-w-0 lg:col-span-8">
              <AnalyticsSnapshotPanel
                cashFlow={summary.cashFlow}
                totalAssets={summary.totalAssets}
                totalDebts={summary.totalDebts}
                cardDebt={summary.totalCreditCardDebt}
                loanDebt={summary.totalLoanDebt}
                personalDebt={summary.totalPersonalDebts}
              />
            </div>

            <div className="min-w-0 lg:col-span-4">
              <SmartInsightsPanel insights={insights} />
            </div>

            <UpcomingAlertPanel items={outflowUpcoming} />

            {/* ─ Birikim & harcama bölümü ─ */}
            <DetailSectionDivider label="Birikim ve harcama" />

            <div className="min-w-0 lg:col-span-5">
              <GoalProgressCommand goalProgress={summary.goalProgress} />
            </div>

            <div className="min-w-0 lg:col-span-7">
              <SpendingRadarPanel expenses={data.cardExpenses} />
            </div>

            {/* ─ Mutabakat ─ */}
            <div className="min-w-0 lg:col-span-12">
              <ReconciliationPanel cards={data.cards} statements={data.cardStatements.filter((statement) => statement.status === 'open')} />
            </div>

            {/* ─ Limit & kredi ritmi bölümü ─ */}
            <DetailSectionDivider label="Limitler ve kredi ritmi" />

            {hasCreditLimitGroups ? (
              <div className="min-w-0 lg:col-span-7">
                <CreditLimitSection groups={summary.creditLimitGroups} totalUsageRate={summary.creditUsageRate} />
              </div>
            ) : null}

            <div className={`grid min-w-0 gap-3 min-[520px]:grid-cols-2 ${hasCreditLimitGroups ? 'lg:col-span-5 lg:grid-cols-1' : 'lg:col-span-12'}`}>
              <PulseCard
                title="Kredi ritmi"
                label="Aylık ödeme"
                value={formatCurrency(summary.totalLoanMonthlyPayment)}
                description={`${formatCurrency(summary.totalLoanDebt)} aktif kredi borcu`}
                icon={<Landmark />}
                tone="rose"
              />
              <SalaryPulse trend={summary.salaryTrend} />
            </div>

            <div className="grid min-w-0 gap-3 min-[520px]:grid-cols-2 lg:col-span-12">
              <MetricTile label="Toplam limit" value={formatCurrency(summary.totalCreditLimit)} icon={<CreditCard />} tone="indigo" help={dashboardHelp.totalLimit} />
              <MetricTile label="Kredi ödemesi" value={formatCurrency(summary.totalLoanMonthlyPayment)} icon={<CalendarDays />} tone="stone" help={dashboardHelp.loanPayment} />
            </div>

            {/* ─ Geçmiş ─ */}
            <DetailSectionDivider label="Geçmiş işlemler" />

            <div className="min-w-0 lg:col-span-12">
              <HistorySection rows={data.transactionHistory} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  )
}

function DetailSectionDivider({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 lg:col-span-12">
      <div className="h-px flex-1 bg-border/50" aria-hidden="true" />
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">{label}</span>
      <div className="h-px flex-1 bg-border/50" aria-hidden="true" />
    </div>
  )
}
