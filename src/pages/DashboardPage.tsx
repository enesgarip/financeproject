import { AlertTriangle, ArrowUpRight, CalendarDays, CreditCard, Landmark } from 'lucide-react'
import { motion, type Variants } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { ensureRatesLoaded } from '../lib/marketRatesClient'
import { supabase } from '../lib/supabase'
import { syncAutoValuedRows } from '../utils/valuationSync'
import type {
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
  AnalyticsSnapshotPanel,
  CashFlowCalendarPanel,
  CashFlowPanel,
  CreditCardSnapshotPanel,
  CreditLimitSection,
  CurrentDebtTotalsPanel,
  DashboardHero,
  FocusActionPanel,
  GoalProgressCommand,
  HistorySection,
  MetricTile,
  MonthlyPaymentLoadPanel,
  PulseCard,
  SalaryPulse,
  SmartInsightsPanel,
  SpendingRadarPanel,
  UpcomingAlertPanel,
  type FocusAction,
  type SmartInsight,
} from '../components/dashboard/DashboardPanels'
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
  buildMonthlyLoad,
  cardProvisionAmount,
  cardSplitTotal,
  getSalaryTrend,
  moneyDiffers,
  roundMoney,
  sum,
  totalCreditLimit,
  type CashFlowSummary,
} from '../utils/financeSummary'
import { buildAttentionLine } from '../utils/attention'
import { buildDashboardUpcomingItems, type DashboardUpcomingItem } from '../utils/dashboardUpcoming'
import { formatCurrency } from '../utils/formatCurrency'
import { isMissingSupabaseCapabilityError } from '../utils/supabaseErrors'
import { SkeletonDashboard } from '../components/ui/skeleton'
import { canCutCurrentStatement } from '../utils/statementCycle'

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
}

const UPCOMING_DAYS = 30
const DASHBOARD_HISTORY_MONTHS = 3
const DASHBOARD_SPENDING_MONTHS = 4

type UpcomingItem = DashboardUpcomingItem

function isMissingSchemaCacheError(error: { code?: string; message?: string } | null | undefined) {
  return isMissingSupabaseCapabilityError(error)
}

function buildSmartInsights(
  cashFlow: CashFlowSummary,
  creditUsageRate: number,
  totalDebts: number,
  totalReceivables: number,
  upcomingItems: UpcomingItem[],
): SmartInsight[] {
  const insights: SmartInsight[] = []
  const urgentCount = upcomingItems.filter((item) => {
    const remaining = daysUntil(new Date(item.sortTime))
    return remaining !== null && remaining <= 7
  }).length

  if (cashFlow.projectedCash < 0) {
    insights.push({
      title: 'Ay sonu nakit açığı görünüyor',
      description: `${cashFlow.monthLabel} projeksiyonu ${formatCurrency(cashFlow.projectedCash)}. Büyük ödemeleri veya tahsilatı öne almak iyi olur.`,
      tone: 'rose',
    })
  } else if (cashFlow.netFlow < 0) {
    insights.push({
      title: 'Bu ay nakit azalıyor',
      description: `Net akış ${formatCurrency(cashFlow.netFlow)}. Ay sonu pozitif kalsa da çıkış temposu gelirden yüksek.`,
      tone: 'amber',
    })
  } else {
    insights.push({
      title: 'Bu ay nakit akışı rahat',
      description: `Tahmini net akış +${formatCurrency(cashFlow.netFlow)}. Fazlayı kart borcu, hedef veya yatırım tarafına ayırabilirsin.`,
      tone: 'emerald',
    })
  }

  if (urgentCount > 0) {
    insights.push({
      title: `${urgentCount} yakın vade var`,
      description: 'Önümüzdeki 7 gün içinde ödeme takibi gerekiyor. En yakın kalemleri ödeme alarmında öne aldım.',
      tone: urgentCount >= 3 ? 'rose' : 'amber',
    })
  }

  if (creditUsageRate >= 80) {
    insights.push({
      title: 'Kart limit kullanımı yüksek',
      description: `Toplam limitin yaklaşık %${Math.round(creditUsageRate)} kullanılıyor. Yeni harcamalarda taksit ve limit grubuna dikkat.`,
      tone: 'rose',
    })
  } else if (creditUsageRate >= 55) {
    insights.push({
      title: 'Kart kullanımı izlenmeli',
      description: `Limit kullanımın %${Math.round(creditUsageRate)} seviyesinde. Ekstre kesilmeden önce dönem içi harcamayı kontrol etmek iyi olur.`,
      tone: 'amber',
    })
  }

  if (totalReceivables > 0 && totalDebts > 0) {
    insights.push({
      title: 'Alacaklar borcu dengeleyebilir',
      description: `${formatCurrency(totalReceivables)} açık alacak var. Tahsilat tarihleri nakit açığını yumuşatabilir.`,
      tone: 'stone',
    })
  }

  return insights.slice(0, 4)
}

function buildFocusActions(data: DashboardData, cashFlow: CashFlowSummary, creditUsageRate: number, upcomingItems: UpcomingItem[]): FocusAction[] {
  const actions: FocusAction[] = []
  const bankAccounts = data.cards.filter((card) => card.card_type === 'banka_karti')
  const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  const overduePayments = data.payments.filter((payment) => {
    const remaining = daysUntil(payment.due_date)
    return payment.status === 'bekliyor' && remaining !== null && remaining < 0
  })
  const overdueLoanInstallments = data.loanInstallments.filter((installment) => {
    const remaining = daysUntil(installment.due_date)
    return installment.status === 'bekliyor' && remaining !== null && remaining < 0
  })
  const urgentCount = upcomingItems.filter((item) => {
    const remaining = daysUntil(new Date(item.sortTime))
    return remaining !== null && remaining >= 0 && remaining <= 3
  }).length
  const scheduledInstallmentsByCard = new Map<string, number>()
  for (const item of data.cardInstallments) {
    if (item.status !== 'scheduled') continue
    scheduledInstallmentsByCard.set(item.card_id, roundMoney((scheduledInstallmentsByCard.get(item.card_id) ?? 0) + item.amount))
  }

  const cardSplitIssues = creditCards.filter(
    (card) => cardSplitTotal(card.statement_debt_amount, card.current_period_spending, cardProvisionAmount(card)) > card.debt_amount + 0.01,
  )
  const cardScheduledDebtIssues = creditCards.filter((card) => {
    const splitTotal = cardSplitTotal(card.statement_debt_amount, card.current_period_spending, cardProvisionAmount(card))
    const scheduledTotal = scheduledInstallmentsByCard.get(card.id) ?? 0
    return scheduledTotal > 0.01 && card.debt_amount <= splitTotal + 0.01
  })
  const unclassifiedCardDebts = creditCards.filter((card) => {
    const splitTotal = cardSplitTotal(card.statement_debt_amount, card.current_period_spending, cardProvisionAmount(card))
    const scheduledTotal = scheduledInstallmentsByCard.get(card.id) ?? 0
    const unclassifiedAmount = roundMoney(card.debt_amount - splitTotal)
    const unexplainedAmount = roundMoney(unclassifiedAmount - Math.min(unclassifiedAmount, scheduledTotal))
    return unexplainedAmount > 0.01
  })
  const cardsWithProvisions = creditCards.filter((card) => cardProvisionAmount(card) > 0)
  const totalProvision = sum(cardsWithProvisions, cardProvisionAmount)
  const statementReadyCards = creditCards.filter((card) => canCutCurrentStatement(card, data.cardStatements))
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
  const loansWithoutPlan = data.loans.filter((loan) => loan.status === 'active' && loan.remaining_installments > 0 && !plannedLoanIds.has(loan.id))
  const loanInstallmentsByLoan = new Map<string, LoanInstallment[]>()

  for (const item of data.loanInstallments) {
    loanInstallmentsByLoan.set(item.loan_id, [...(loanInstallmentsByLoan.get(item.loan_id) ?? []), item])
  }

  const loanSummaryDrifts = data.loans.filter((loan) => {
    const rows = loanInstallmentsByLoan.get(loan.id) ?? []
    if (rows.length === 0) return false

    const pending = rows.filter((item) => item.status !== 'ödendi')
    const remainingAmount = pending.reduce((total, item) => total + item.amount, 0)
    const expectedStatus = pending.length === 0 ? 'closed' : 'active'

    return moneyDiffers(loan.remaining_amount, remainingAmount) || loan.remaining_installments !== pending.length || loan.status !== expectedStatus
  })

  if (bankAccounts.length === 0) {
    actions.push({
      id: 'setup-bank-account',
      title: 'Önce bir banka hesabı ekle',
      description: 'Ödeme, kredi taksidi ve borç kapatma akışları için kaynak hesap gerekiyor.',
      to: '/kartlar',
      cta: 'Hesap ekle',
      tone: 'rose',
      icon: 'card',
      priority: 1,
    })
  }

  if (overduePayments.length + overdueLoanInstallments.length > 0) {
    actions.push({
      id: 'overdue-payments',
      title: `${overduePayments.length + overdueLoanInstallments.length} geciken ödeme var`,
      description: 'Geciken ödeme ve kredi taksitlerini öne aldım; nakit planını bozmadan kapatmak iyi olur.',
      to: overduePayments.length > 0 ? '/odemeler' : '/borclar/krediler',
      cta: 'Gecikeni gör',
      tone: 'rose',
      icon: 'alert',
      priority: 2,
    })
  }

  if (cashFlow.projectedCash < 0) {
    actions.push({
      id: 'cash-gap',
      title: 'Ay sonu nakit açığı görünüyor',
      description: `${cashFlow.monthLabel} projeksiyonu ${formatCurrency(cashFlow.projectedCash)}. Ödeme tarihlerini ve tahsilatları birlikte kontrol et.`,
      to: '/analiz',
      cta: 'Raporlara git',
      tone: 'rose',
      icon: 'alert',
      priority: 3,
    })
  }

  if (urgentCount > 0) {
    actions.push({
      id: 'urgent-upcoming',
      title: `${urgentCount} vade 3 gün içinde`,
      description: 'Yakın vadeleri kaçırmamak için ödeme alarmındaki ilk kalemlerden başlamak en güvenlisi.',
      to: '/odemeler',
      cta: 'Vadeleri gör',
      tone: urgentCount >= 3 ? 'rose' : 'amber',
      icon: 'calendar',
      priority: 4,
    })
  }

  if (totalProvision > 0) {
    actions.push({
      id: 'card-provisions',
      title: `${formatCurrency(totalProvision)} provizyon bekliyor`,
      description: 'Kesinleşenleri güncel borca aktar, iptal olanları limitten çıkar.',
      to: '/kartlar?section=ekstreler',
      cta: 'Provizyonları aç',
      tone: 'amber',
      icon: 'card',
      priority: 4.5,
    })
  }

  if (statementReadyCards.length > 0) {
    actions.push({
      id: 'statement-ready',
      title: `${statementReadyCards.length} kartta ekstre kesilebilir`,
      description: 'Dönem içi kesinleşen harcamalar ekstre borcuna aktarılmaya hazır görünüyor.',
      to: '/kartlar?section=ekstreler',
      cta: 'Ekstreleri kontrol et',
      tone: 'indigo',
      icon: 'calendar',
      priority: 4.7,
    })
  }

  const dataHealthIssueCount = cardSplitIssues.length + cardScheduledDebtIssues.length + unclassifiedCardDebts.length + loanSummaryDrifts.length

  if (dataHealthIssueCount > 0) {
    actions.push({
      id: 'data-health',
      title: 'Kayıt kontrolü önerisi var',
      description: `${dataHealthIssueCount} kayıt için güvenli düzeltme önerisi hazır.`,
      to: '/veri-sagligi',
      cta: 'Veri kontrolü',
      tone: 'stone',
      icon: 'health',
      priority: 50,
    })
  }

  if (loansWithoutPlan.length > 0) {
    actions.push({
      id: 'loan-plan',
      title: `${loansWithoutPlan.length} kredide ödeme planı eksik`,
      description: 'Plan oluşunca yaklaşan taksitler, analiz ve nakit akışı daha doğru çalışır.',
      to: '/borclar/krediler',
      cta: 'Plan oluştur',
      tone: 'indigo',
      icon: 'loan',
      priority: 6,
    })
  }

  if (creditUsageRate >= 80) {
    actions.push({
      id: 'credit-usage',
      title: 'Kart limit kullanımı yüksek',
      description: `Toplam limitin yaklaşık %${Math.round(creditUsageRate)} kullanılıyor. Ortak limit ve dönem içi harcamayı kontrol et.`,
      to: '/kartlar',
      cta: 'Kartlara git',
      tone: 'amber',
      icon: 'card',
      priority: 7,
    })
  }

  if (!data.salaryHistory.length) {
    actions.push({
      id: 'salary-setup',
      title: 'Maaş bilgisini ekle',
      description: 'Maaş geçmişi girilince aylık nakit akışı ve ay sonu tahmini daha gerçekçi olur.',
      to: '/varliklar',
      cta: 'Maaş ekle',
      tone: 'emerald',
      icon: 'check',
      priority: 20,
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: 'all-clear',
      title: 'Bugün sakin görünüyor',
      description: 'Yakın vade, bakiye açığı veya limit uyarısı yok.',
      to: '/kartlar',
      cta: 'Hesaplara bak',
      tone: 'emerald',
      icon: 'check',
      priority: 100,
    })
  }

  return actions.sort((a, b) => a.priority - b.priority)
}

export function DashboardPage() {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const displayName = useMemo(() => getUserDisplayName(user), [user])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')

    const valuationSyncPromise = (async () => {
      try {
        const snapshot = await ensureRatesLoaded()
        await syncAutoValuedRows(snapshot)
      } catch {
        // Non-fatal: dashboard still renders with the last stored valuation.
      }
    })()
    const autoPayments = await supabase.rpc('post_due_card_auto_payments')
    const statementCut = await supabase.rpc('cut_due_card_statements')
    const maintenanceError = [autoPayments.error, statementCut.error].find((item) => item && !isMissingSchemaCacheError(item))
    if (maintenanceError) {
      setError(maintenanceError.message)
      setLoading(false)
      return
    }

    // Refresh live rates and re-value auto-valued gold/FX rows so net worth and
    // cash-flow math below read up-to-date stored values. Best-effort: a feed
    // outage just leaves the last known values in place.
    await valuationSyncPromise
    const currentMonthStart = startOfMonth()
    const historyStart = addMonths(currentMonthStart, -DASHBOARD_HISTORY_MONTHS)
    const spendingStart = dateInputValue(addMonths(currentMonthStart, -DASHBOARD_SPENDING_MONTHS))
    const currentMonth = dateInputValue(currentMonthStart)

    const [
      assets,
      cards,
      loans,
      loanInstallments,
      debts,
      payments,
      salaryHistory,
      transactionHistory,
      budgets,
      cardExpenses,
      cardInstallments,
      cardStatements,
      savingsGoals,
      savingsGoalComponents,
    ] =
      await Promise.all([
        supabase.from('assets').select('*'),
        supabase.from('cards').select('*'),
        supabase.from('loans').select('*'),
        supabase.from('loan_installments').select('*'),
        supabase.from('debts').select('*'),
        supabase.from('payments').select('*'),
        supabase.from('salary_history').select('*').order('effective_date', { ascending: false }),
        supabase.from('transaction_history').select('*').gte('occurred_at', historyStart.toISOString()).order('occurred_at', { ascending: false }),
        supabase.from('budgets').select('*').eq('month', currentMonth),
        supabase.from('card_expenses').select('*').gte('spent_at', spendingStart).order('spent_at', { ascending: false }),
        supabase.from('card_installments').select('*'),
        supabase.from('card_statement_archives').select('*').order('statement_date', { ascending: false }).limit(120),
        supabase.from('savings_goals').select('*'),
        supabase.from('savings_goal_components').select('*'),
      ])

    const firstError = [
      assets.error,
      cards.error,
      loans.error,
      loanInstallments.error,
      debts.error,
      payments.error,
      salaryHistory.error,
      transactionHistory.error,
      isMissingSchemaCacheError(budgets.error) ? null : budgets.error,
      cardExpenses.error,
      isMissingSchemaCacheError(cardInstallments.error) ? null : cardInstallments.error,
      isMissingSchemaCacheError(cardStatements.error) ? null : cardStatements.error,
      isMissingSchemaCacheError(savingsGoals.error) ? null : savingsGoals.error,
      isMissingSchemaCacheError(savingsGoalComponents.error) ? null : savingsGoalComponents.error,
    ].find(Boolean)
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    setData({
      assets: assets.data ?? [],
      cards: cards.data ?? [],
      loans: loans.data ?? [],
      loanInstallments: loanInstallments.data ?? [],
      debts: debts.data ?? [],
      payments: payments.data ?? [],
      salaryHistory: salaryHistory.data ?? [],
      transactionHistory: transactionHistory.data ?? [],
      budgets: budgets.error ? [] : (budgets.data ?? []),
      cardExpenses: cardExpenses.data ?? [],
      cardInstallments: cardInstallments.error ? [] : (cardInstallments.data ?? []),
      cardStatements: cardStatements.error ? [] : (cardStatements.data ?? []),
      savingsGoals: savingsGoals.error ? [] : (savingsGoals.data ?? []),
      savingsGoalComponents: savingsGoalComponents.error ? [] : (savingsGoalComponents.data ?? []),
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    function reloadWhenVisible() {
      if (document.visibilityState === 'visible') void loadDashboard()
    }

    window.addEventListener('focus', loadDashboard)
    document.addEventListener('visibilitychange', reloadWhenVisible)
    return () => {
      window.removeEventListener('focus', loadDashboard)
      document.removeEventListener('visibilitychange', reloadWhenVisible)
    }
  }, [loadDashboard])

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
    const nextMonthLoad = buildMonthlyLoad(data, addMonths(startOfMonth(), 1))
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
  }, [data])

  const upcomingItems = useMemo(() => {
    return buildDashboardUpcomingItems({
      cards: data.cards,
      payments: data.payments,
      loans: data.loans,
      loanInstallments: data.loanInstallments,
      debts: data.debts,
      cardInstallments: data.cardInstallments,
      cardStatements: data.cardStatements,
    }, UPCOMING_DAYS)
  }, [data.cardInstallments, data.cardStatements, data.cards, data.debts, data.loanInstallments, data.loans, data.payments])
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

  const insights = useMemo(
    () => buildSmartInsights(summary.cashFlow, summary.creditUsageRate, summary.totalDebts, summary.totalReceivables, upcomingItems),
    [summary.cashFlow, summary.creditUsageRate, summary.totalDebts, summary.totalReceivables, upcomingItems],
  )
  const focusActions = useMemo(
    () => buildFocusActions(data, summary.cashFlow, summary.creditUsageRate, upcomingItems),
    [data, summary.cashFlow, summary.creditUsageRate, upcomingItems],
  )
  const attentionLine = useMemo(() => buildAttentionLine(data, upcomingItems), [data, upcomingItems])

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

