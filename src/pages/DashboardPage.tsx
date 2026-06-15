import { AlertTriangle, ArrowUpRight, CalendarDays, CreditCard, Landmark } from 'lucide-react'
import { motion, type Variants } from 'framer-motion'
import { useMemo } from 'react'
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
import { buildHealthCounts } from '../utils/dataHealthSummary'
import { buildSmartInsights, buildFocusActions, reconciliationDriftCount } from '../utils/dashboardInsights'
import { buildDashboardMonthlyLoad, buildDashboardUpcomingItems } from '../utils/dashboardUpcoming'
import { formatCurrency } from '../utils/formatCurrency'
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

export function DashboardPage() {
  const { user } = useAuth()
  const snapshotQuery = useFinanceSnapshot()
  const displayName = useMemo(() => getUserDisplayName(user), [user])

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
    accountReconciliations: data.accountReconciliations,
  }), [data.accountReconciliations, data.cardInstallments, data.cardStatements, data.cards, data.debts, data.loanInstallments, data.loans, data.payments])

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
      nextMonthLoad,
      goalProgress,
    }
  }, [data, obligationInput])

  const upcomingItems = useMemo(() => {
    return buildDashboardUpcomingItems(obligationInput, UPCOMING_DAYS)
  }, [obligationInput])
  const financialHealth = useMemo(() => {
    const urgentUpcomingCount = upcomingItems.filter((item) => {
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
  }, [summary, upcomingItems])

  const reconDriftCount = useMemo(
    () => reconciliationDriftCount(data.cards, data.accountReconciliations),
    [data.cards, data.accountReconciliations],
  )
  const insights = useMemo(
    () => buildSmartInsights(summary.cashFlow, summary.creditUsageRate, summary.totalDebts, summary.totalReceivables, upcomingItems, reconDriftCount),
    [summary.cashFlow, summary.creditUsageRate, summary.totalDebts, summary.totalReceivables, upcomingItems, reconDriftCount],
  )
  const focusActions = useMemo(
    () => buildFocusActions(data, summary.cashFlow, summary.creditUsageRate, upcomingItems),
    [data, summary.cashFlow, summary.creditUsageRate, upcomingItems],
  )
  const attentionLine = useMemo(() => buildAttentionLine(data, upcomingItems), [data, upcomingItems])
  const healthCounts = useMemo(() => buildHealthCounts(data), [data])

  if (loading) {
    return <SkeletonDashboard />
  }

  if (error) {
    return <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p>
  }

  const hasCreditLimitGroups = summary.creditLimitGroups.length > 0
  const upcomingTotal = sum(upcomingItems, (item) => item.amount)

  const stagger: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.06 } },
  }
  const fadeUp: Variants = {
    hidden:  { opacity: 0, y: 14 },
    visible: { opacity: 1, y: 0 },
  }

  return (
    <motion.section
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="grid gap-5 lg:grid-cols-12 lg:items-start"
    >
      {attentionLine ? (
        <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
          <p
            role="status"
            className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold ring-1 ${
              attentionLine.tone === 'danger'
                ? 'bg-destructive/8 text-destructive ring-destructive/25'
                : 'bg-warning/8 text-warning ring-warning/25'
            }`}
          >
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{attentionLine.text}</span>
          </p>
        </motion.div>
      ) : null}

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <DataHealthBadge errors={healthCounts.errors} warnings={healthCounts.warnings} total={healthCounts.total} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-8">
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

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-4">
        <MonthlyPaymentLoadPanel
          cashFlow={summary.cashFlow}
          nextMonthLoad={summary.nextMonthLoad}
          upcomingTotal={upcomingTotal}
          upcomingCount={upcomingItems.length}
        />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-5">
        <CreditCardSnapshotPanel
          cards={data.cards}
          totalDebt={summary.totalCreditCardDebt}
          statementDebt={summary.totalCardStatementDebt}
          totalLimit={summary.totalCreditLimit}
          usageRate={summary.creditUsageRate}
        />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-7">
        <CashFlowCalendarPanel items={upcomingItems} cashFlow={summary.cashFlow} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-4">
        <GoalProgressCommand goalProgress={summary.goalProgress} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-8">
        <AnalyticsSnapshotPanel
          cashFlow={summary.cashFlow}
          totalAssets={summary.totalAssets}
          totalDebts={summary.totalDebts}
          cardDebt={summary.totalCreditCardDebt}
          loanDebt={summary.totalLoanDebt}
          personalDebt={summary.totalPersonalDebts}
        />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <FocusActionPanel actions={focusActions} cashFlow={summary.cashFlow} />
      </motion.div>

      <motion.div variants={fadeUp} className="grid min-w-0 gap-3 min-[760px]:grid-cols-2 lg:col-span-12">
        <StatementReminderPanel cards={data.cards} statements={data.cardStatements} />
        <BudgetAlertPanel budgets={data.budgets} expenses={data.cardExpenses} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <ReconciliationPanel cards={data.cards} statements={data.cardStatements.filter((statement) => statement.status === 'open')} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <SpendingRadarPanel expenses={data.cardExpenses} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-7">
        <CashFlowPanel cashFlow={summary.cashFlow} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-5">
        <CurrentDebtTotalsPanel
          totalDebt={summary.totalDebts}
          cardDebt={summary.totalCreditCardDebt}
          loanDebt={summary.totalLoanDebt}
          personalDebt={summary.totalPersonalDebts}
          paymentDebt={summary.totalPaymentLiabilities}
        />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <SmartInsightsPanel insights={insights} />
      </motion.div>

      <motion.div variants={fadeUp} className="grid min-w-0 gap-3 min-[520px]:grid-cols-3 lg:col-span-12">
        <MetricTile label="Toplam limit" value={formatCurrency(summary.totalCreditLimit)} icon={<CreditCard />} tone="indigo" help={dashboardHelp.totalLimit} />
        <MetricTile label="Kredi ödemesi" value={formatCurrency(summary.totalLoanMonthlyPayment)} icon={<CalendarDays />} tone="stone" help={dashboardHelp.loanPayment} />
        <MetricTile label="Tahsilat" value={formatCurrency(summary.totalReceivables)} icon={<ArrowUpRight />} tone="emerald" help={dashboardHelp.receivable} />
      </motion.div>

      <UpcomingAlertPanel items={upcomingItems} />

      {hasCreditLimitGroups ? (
        <motion.div variants={fadeUp} className="min-w-0 lg:col-span-7">
          <CreditLimitSection groups={summary.creditLimitGroups} totalUsageRate={summary.creditUsageRate} />
        </motion.div>
      ) : null}

      <motion.div variants={fadeUp} className={`grid min-w-0 gap-3 min-[520px]:grid-cols-2 ${hasCreditLimitGroups ? 'lg:col-span-5 lg:grid-cols-1' : 'lg:col-span-12'}`}>
        <PulseCard
          title="Kredi ritmi"
          label="Aylık ödeme"
          value={formatCurrency(summary.totalLoanMonthlyPayment)}
          description={`${formatCurrency(summary.totalLoanDebt)} aktif kredi borcu`}
          icon={<Landmark />}
          tone="rose"
        />
        <SalaryPulse trend={summary.salaryTrend} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <HistorySection rows={data.transactionHistory} />
      </motion.div>
    </motion.section>
  )
}
