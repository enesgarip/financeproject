import type { User } from '@supabase/supabase-js'
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  Lightbulb,
  ListChecks,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { motion, type Variants } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  TransactionHistoryType,
} from '../types/database'
import { BudgetAlertPanel } from '../components/dashboard/BudgetAlertPanel'
import { StatementReminderPanel } from '../components/dashboard/StatementReminderPanel'
import { AmountDisplay, FinancePanel, MetricCard, MiniStat, PageHero, ProgressStrip, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import { addMonths, daysUntil, formatDate, monthlyOccurrenceDate, nextMonthlyDate, startOfMonth } from '../utils/date'
import {
  buildCreditLimitGroups,
  buildFinancialHealth,
  buildFinancialPosition,
  buildGoalProgressSummary,
  buildMonthlyCashFlow,
  buildMonthlyLoad,
  cardMonthlyPaymentAmount,
  cardProvisionAmount,
  cardSplitTotal,
  getSalaryTrend,
  moneyDiffers,
  roundMoney,
  sum,
  totalCreditLimit,
  type CashFlowSummary,
  type CreditLimitGroup,
  type FinancialHealthSummary,
  type GoalProgressSummary,
  type MonthlyLoadSummary,
} from '../utils/financeSummary'
import { buildDashboardUpcomingItems, type DashboardUpcomingItem } from '../utils/dashboardUpcoming'
import { formatCurrency } from '../utils/formatCurrency'
import { detectSpendingAnomalies } from '../utils/spendingAnomalies'
import { isMissingSupabaseCapabilityError } from '../utils/supabaseErrors'
import { EmptyState } from '../components/EmptyState'
import { CashFlowChart, type CashFlowPoint } from '../components/charts/CashFlowChart'
import { DonutChart, type DonutSlice } from '../components/charts/DonutChart'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { HelpTooltip, type HelpTooltipContent } from '../components/ui/help-tooltip'
import { Input } from '../components/ui/input'
import { Progress } from '../components/ui/progress'
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

const dashboardHelp = {
  netWorth: {
    calculation: 'Varlıklardan kart, kredi, kişisel borç ve bekleyen fatura/ödeme yükleri düşülür; alacaklar ayrıca gösterilir.',
    importance: 'Alacakları tahsil edilmiş varsaymadan gerçek net değerin artıda mı ekside mi olduğunu gösterir.',
    source: 'Varlıklar, banka kartları, kredi kartları, krediler, planlı ödemeler ve borç/alacak kayıtları.',
  },
  cashFlow: {
    calculation: 'Bu ayki maaş ve alacaklardan; kart ekstresi, kredi, ödeme ve kişisel borç çıkışları düşülür.',
    importance: 'Ay bitmeden nakit açığı oluşup oluşmayacağını erkenden görmeni sağlar.',
    source: 'Maaş geçmişi, ödemeler, kart son ödeme günleri, krediler ve borç kayıtları.',
  },
  periodDebt: {
    calculation: 'Bu ay ödenmesi beklenen kart ekstresi, kredi taksidi, fatura/ödeme ve kişisel borçlar gruplanır.',
    importance: 'Ay içindeki gerçek ödeme baskısını hangi kalemin oluşturduğunu ayırır.',
    source: 'Kart, kredi, ödeme ve borç kayıtlarındaki vade/tarih alanları.',
  },
  nextMonthLoad: {
    calculation: 'Gelecek ayki planlı ödemeler, açık ekstreler, kart taksit planı, kredi taksitleri ve kişisel borçlar toplanır.',
    importance: 'Önümüzdeki ayın yükünü bugünden görüp nakit ayırmana yardım eder.',
    source: 'Ödeme planları, kart taksitleri, kredi taksitleri ve açık borç kayıtları.',
  },
  currentDebt: {
    calculation: 'Kredi kartı toplam borcu, aktif kredi kalan borcu, açık kişisel borçlar ve bekleyen planlı ödemeler toplanır.',
    importance: 'Bugün kapatılması veya yönetilmesi gereken toplam yükü gösterir.',
    source: 'Kartlar, krediler, planlı ödemeler ve borç/alacak ekranındaki açık kayıtlar.',
  },
  totalLimit: {
    calculation: 'Ortak limit grubunda limitler toplanmaz; grup için en yüksek limit alınır, tekil kartlar ayrıca eklenir.',
    importance: 'Kredi limitini olduğundan yüksek göstermeden gerçek kullanım alanını anlatır.',
    source: 'Kartlar ekranındaki kredi limiti ve ortak limit grubu alanları.',
  },
  loanPayment: {
    calculation: 'Aktif kredilerin aylık ödeme tutarları toplanır.',
    importance: 'Her ay düzenli ayrılması gereken kredi nakdini hızlıca gösterir.',
    source: 'Krediler ekranındaki aktif kredi kayıtları.',
  },
  receivable: {
    calculation: 'Durumu açık olan “borç verdim” kayıtlarının tahmini TL değeri toplanır.',
    importance: 'Gelebilecek parayı borç yükünden ayrı görmeni sağlar.',
    source: 'Kişiler ekranındaki açık alacak kayıtları.',
  },
  creditLimit: {
    calculation: 'Her limit grubunda en yüksek limit alınır; grup borcu ise kart borçlarının toplamıdır.',
    importance: 'Özellikle ortak limitli kartlarda kalan alanı daha doğru takip eder.',
    source: 'Kredi kartı limitleri, borç tutarları ve ortak limit grubu kayıtları.',
  },
} satisfies Record<string, HelpTooltipContent>

const historyFilters: Array<{ label: string; value: TransactionHistoryType | 'all' }> = [
  { label: 'Tümü', value: 'all' },
  { label: 'Ödeme', value: 'payment' },
  { label: 'Transfer', value: 'transfer' },
  { label: 'Kredi', value: 'loan' },
  { label: 'Borç', value: 'debt' },
  { label: 'Kart', value: 'card' },
]

type UpcomingItem = DashboardUpcomingItem

type SmartInsight = {
  title: string
  description: string
  tone: 'emerald' | 'amber' | 'rose' | 'stone'
}

type FocusAction = {
  id: string
  title: string
  description: string
  to: string
  cta: string
  tone: 'emerald' | 'amber' | 'rose' | 'indigo' | 'stone'
  icon: 'alert' | 'calendar' | 'card' | 'check' | 'health' | 'loan'
  priority: number
}

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
  const statementReadyCards = creditCards.filter((card) => {
    if (card.current_period_spending <= 0 || !card.statement_day) return false
    const statementDate = monthlyOccurrenceDate(card.statement_day)
    const remaining = daysUntil(statementDate)
    return remaining !== null && remaining <= 0
  })
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
      to: overduePayments.length > 0 ? '/odemeler' : '/krediler',
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
      to: '/kartlar',
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
      to: '/kartlar',
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
      to: '/krediler',
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

    const { error: statementCutError } = await supabase.rpc('cut_due_card_statements')
    if (statementCutError && !isMissingSchemaCacheError(statementCutError)) {
      setError(statementCutError.message)
      setLoading(false)
      return
    }

    // Refresh live rates and re-value auto-valued gold/FX rows so net worth and
    // cash-flow math below read up-to-date stored values. Best-effort: a feed
    // outage just leaves the last known values in place.
    try {
      const snapshot = await ensureRatesLoaded()
      await syncAutoValuedRows(snapshot)
    } catch {
      // Non-fatal — dashboard still renders with the last stored valuation.
    }

    const historyStart = new Date()
    historyStart.setMonth(historyStart.getMonth() - 3)

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
        supabase.from('budgets').select('*'),
        supabase.from('card_expenses').select('*'),
        supabase.from('card_installments').select('*'),
        supabase.from('card_statement_archives').select('*').eq('status', 'open'),
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

      <motion.div variants={fadeUp} className="grid min-w-0 gap-3 min-[760px]:grid-cols-3 lg:col-span-12">
        <FinancialHealthPanel health={financialHealth} goalProgress={summary.goalProgress} />
        <StatementReminderPanel cards={data.cards} />
        <BudgetAlertPanel budgets={data.budgets} expenses={data.cardExpenses} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-12">
        <SpendingRadarPanel expenses={data.cardExpenses} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-7">
        <CashFlowPanel cashFlow={summary.cashFlow} />
      </motion.div>

      <motion.div variants={fadeUp} className="grid min-w-0 gap-3 min-[760px]:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
        <NextMonthLoadPanel load={summary.nextMonthLoad} />
        <PeriodDebtTotalsPanel cashFlow={summary.cashFlow} />
        <CurrentDebtTotalsPanel
          totalDebt={summary.totalDebts}
          cardDebt={summary.totalCreditCardDebt}
          loanDebt={summary.totalLoanDebt}
          personalDebt={summary.totalPersonalDebts}
          paymentDebt={summary.totalPaymentLiabilities}
        />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-7">
        <SmartInsightsPanel insights={insights} />
      </motion.div>

      <motion.div variants={fadeUp} className="min-w-0 lg:col-span-5">
        <ScenarioSimulator cashFlow={summary.cashFlow} netWorth={summary.netWorth} />
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

function DashboardHero({
  displayName,
  netWorth,
  totalAssets,
  totalDebts,
  totalReceivables,
  cashFlow,
  health,
}: {
  displayName: string
  netWorth: number
  totalAssets: number
  totalDebts: number
  totalReceivables: number
  cashFlow: CashFlowSummary
  health: FinancialHealthSummary
}) {
  const netWorthTone = netWorth >= 0 ? 'good' : 'danger'
  const debtPressure = totalAssets > 0 ? Math.min(100, (totalDebts / totalAssets) * 100) : totalDebts > 0 ? 100 : 0
  const projectedTone = cashFlow.projectedCash >= 0 ? 'good' : 'danger'

  return (
    <PageHero
      label="Finansal durum"
      title={displayName ? `Merhaba, ${displayName}` : 'Bugünkü finans tablon'}
      amount={formatCurrency(netWorth)}
      tone={netWorthTone}
      description={`${cashFlow.monthLabel} için net varlık, borç baskısı ve nakit projeksiyonu tek bakışta.`}
      action={<StatusBadge tone={health.tone === 'emerald' ? 'good' : health.tone === 'amber' ? 'warning' : 'danger'}>{health.label}</StatusBadge>}
    >
      <div className="grid gap-2 min-[520px]:grid-cols-4">
        <MiniStat label="Toplam varlık" value={formatCurrency(totalAssets)} tone="good" />
        <MiniStat label="Toplam borç" value={formatCurrency(totalDebts)} tone={totalDebts > 0 ? 'danger' : 'good'} />
        <MiniStat label="Ay sonu nakit" value={formatCurrency(cashFlow.projectedCash)} tone={projectedTone} />
        <MiniStat label="Bekleyen tahsilat" value={formatCurrency(totalReceivables)} tone={totalReceivables > 0 ? 'info' : 'neutral'} />
      </div>
      <ProgressStrip
        label="Borç / varlık baskısı"
        value={debtPressure}
        tone={debtPressure >= 75 ? 'danger' : debtPressure >= 45 ? 'warning' : 'good'}
        detail={health.description}
      />
    </PageHero>
  )
}

function MonthlyPaymentLoadPanel({
  cashFlow,
  nextMonthLoad,
  upcomingTotal,
  upcomingCount,
}: {
  cashFlow: CashFlowSummary
  nextMonthLoad: MonthlyLoadSummary
  upcomingTotal: number
  upcomingCount: number
}) {
  const loadRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : cashFlow.outflow > 0 ? 100 : 0
  const tone = loadRate >= 90 ? 'danger' : loadRate >= 65 ? 'warning' : 'good'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Bu ay ödeme yükü"
        description="Kart, kredi, fatura ve kişisel borç baskısı."
        action={<StatusBadge tone={tone}>{upcomingCount > 0 ? `${upcomingCount} vade` : 'Takvim temiz'}</StatusBadge>}
      />
      <div className="mt-5">
        <AmountDisplay label={cashFlow.monthLabel} value={formatCurrency(cashFlow.outflow)} tone={tone} size="lg" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Yaklaşan toplam" value={upcomingCount > 0 ? formatCurrency(upcomingTotal) : 'Yok'} tone={upcomingCount > 0 ? 'warning' : 'good'} />
        <MiniStat label="Gelecek ay" value={formatCurrency(nextMonthLoad.total)} tone={nextMonthLoad.total > cashFlow.outflow ? 'warning' : 'neutral'} />
      </div>
      <div className="mt-5">
        <ProgressStrip label="Gelire göre çıkış" value={loadRate} tone={tone} />
      </div>
    </FinancePanel>
  )
}

function CreditCardSnapshotPanel({
  cards,
  totalDebt,
  statementDebt,
  totalLimit,
  usageRate,
}: {
  cards: FinanceCard[]
  totalDebt: number
  statementDebt: number
  totalLimit: number
  usageRate: number
}) {
  const creditCards = cards.filter((card) => card.card_type === 'kredi_karti')
  const visibleCards = [...creditCards].sort((left, right) => right.debt_amount - left.debt_amount).slice(0, 3)
  const availableLimit = Math.max(0, totalLimit - totalDebt)
  const dueSoonCount = creditCards.filter((card) => {
    const remaining = daysUntil(nextMonthlyDate(card.due_day))
    return cardMonthlyPaymentAmount(card) > 0 && remaining !== null && remaining >= 0 && remaining <= 7
  }).length
  const tone = usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Kredi kartları"
        description="Açık ekstre, limit ve yaklaşan son ödeme odağı."
        action={<StatusBadge tone={dueSoonCount > 0 ? 'warning' : 'good'}>{dueSoonCount > 0 ? `${dueSoonCount} yakın vade` : 'Kontrol altında'}</StatusBadge>}
      />
      <div className="mt-5">
        <AmountDisplay label="Toplam kart borcu" value={formatCurrency(totalDebt)} tone={tone} size="lg" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Açık ekstre" value={formatCurrency(statementDebt)} tone={statementDebt > 0 ? 'warning' : 'good'} />
        <MiniStat label="Kullanılabilir" value={formatCurrency(availableLimit)} tone="good" />
      </div>
      <div className="mt-5">
        <ProgressStrip label="Limit kullanımı" value={usageRate} tone={tone} detail={`${creditCards.length} kredi kartı takipte`} />
      </div>
      {visibleCards.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          {visibleCards.map((card) => (
            <Link key={card.id} to="/kartlar" className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-background/65 px-3 py-2.5 ring-1 ring-border/70 transition hover:bg-muted">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{card.card_name}</p>
                <p className="truncate text-xs text-muted-foreground">{card.bank_name}</p>
              </div>
              <p className="finance-value shrink-0 text-sm font-black text-foreground">{formatCurrency(card.debt_amount)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-background/65 p-3 text-sm text-muted-foreground ring-1 ring-border/70">Henüz kredi kartı yok; kart ekleyince ekstre ve limit takibi burada görünür.</p>
      )}
    </FinancePanel>
  )
}

function GoalProgressCommand({ goalProgress }: { goalProgress: GoalProgressSummary }) {
  const tone = goalProgress.activeCount === 0 ? 'info' : goalProgress.averageProgress >= 70 ? 'good' : goalProgress.averageProgress >= 35 ? 'warning' : 'info'

  return (
    <FinancePanel tone={tone} className="p-4 sm:p-5">
      <SectionHeader
        title="Hedef ilerlemeleri"
        description="Aktif hedeflerin ortalama ilerleme durumu."
        action={<StatusBadge tone={tone}>{goalProgress.activeCount} hedef</StatusBadge>}
      />
      <div className="mt-5">
        <ProgressStrip label="Ortalama ilerleme" value={goalProgress.averageProgress} tone={tone} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStat label="Sıradaki hedef" value={goalProgress.nextGoalName ?? 'Henüz yok'} tone={goalProgress.nextGoalName ? 'premium' : 'neutral'} />
        <MiniStat label="Aylık ihtiyaç" value={formatCurrency(goalProgress.nextGoalMonthlyNeed)} tone={goalProgress.nextGoalMonthlyNeed > 0 ? 'warning' : 'neutral'} />
      </div>
    </FinancePanel>
  )
}

function AnalyticsSnapshotPanel({
  cashFlow,
  totalAssets,
  totalDebts,
  cardDebt,
  loanDebt,
  personalDebt,
}: {
  cashFlow: CashFlowSummary
  totalAssets: number
  totalDebts: number
  cardDebt: number
  loanDebt: number
  personalDebt: number
}) {
  const assetDebtRatio = totalAssets > 0 ? Math.min(100, (totalDebts / totalAssets) * 100) : totalDebts > 0 ? 100 : 0

  const donutData: DonutSlice[] = [
    ...(cardDebt > 0    ? [{ name: 'Kart',    value: cardDebt,     color: 'var(--warning)' }]     : []),
    ...(loanDebt > 0    ? [{ name: 'Kredi',   value: loanDebt,     color: 'var(--info)' }]         : []),
    ...(personalDebt > 0? [{ name: 'Kişisel', value: personalDebt, color: 'var(--destructive)' }]  : []),
  ]

  return (
    <FinancePanel className="p-4 sm:p-5">
      <SectionHeader title="Analiz kartları" description="Gelir/gider ve borç dağılımını hızlı kontrol et." />
      <div className="mt-4 grid gap-3 min-[720px]:grid-cols-3">
        {/* Net flow card */}
        <MetricCard
          label="Gelir / Gider"
          value={`${cashFlow.netFlow >= 0 ? '+' : ''}${formatCurrency(cashFlow.netFlow)}`}
          description={`Gelir ${formatCurrency(cashFlow.income)} · Çıkış ${formatCurrency(cashFlow.outflow)}`}
          tone={cashFlow.netFlow >= 0 ? 'good' : 'danger'}
          icon={TrendingUp}
          deltaLabel={cashFlow.netFlow >= 0 ? 'up' : 'down'}
          delta={cashFlow.netFlow >= 0 ? 'Pozitif akış' : 'Nakit açığı'}
        />

        {/* Debt donut */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="finance-label mb-3">Borç Dağılımı</p>
          {donutData.length > 0 ? (
            <DonutChart data={donutData} size={176} innerRadius={48} totalLabel="Toplam Borç" />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              Borç kaydı yok
            </div>
          )}
        </div>

        {/* Asset/debt ratio */}
        <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-[var(--shadow-card)]">
          <AmountDisplay
            label="Varlık / Borç Baskısı"
            value={`%${Math.round(assetDebtRatio)}`}
            tone={assetDebtRatio >= 80 ? 'danger' : assetDebtRatio >= 45 ? 'warning' : 'good'}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Varlık {formatCurrency(totalAssets)} · Borç {formatCurrency(totalDebts)}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <ProgressStrip label="Borç Baskısı" value={assetDebtRatio} tone={assetDebtRatio >= 80 ? 'danger' : assetDebtRatio >= 45 ? 'warning' : 'good'} />
          </div>
        </div>
      </div>
    </FinancePanel>
  )
}

function getUserDisplayName(user: User | null) {
  const metadata = user?.user_metadata
  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : ''
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : ''

  return fullName || name
}



function FocusActionPanel({ actions, cashFlow }: { actions: FocusAction[]; cashFlow: CashFlowSummary }) {
  const [showAll, setShowAll] = useState(false)
  const primaryAction = actions[0]
  const cashIsPositive = cashFlow.projectedCash >= 0
  const statusLabel = primaryAction.priority <= 20 ? 'Aksiyon gerekli' : 'Takip temiz'
  const visibleActions = showAll ? actions : actions.slice(0, 4)
  const hiddenCount = Math.max(0, actions.length - 4)

  return (
    <Card className="border-0 bg-card/95 py-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardContent className="p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:items-stretch">
          <div className="flex min-w-0 flex-col justify-between rounded-lg border border-border/75 bg-surface-muted p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-primary">Bugünün odağı</p>
                <h2 className="mt-2 text-2xl font-black leading-tight text-foreground">{statusLabel}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  En önemli finans aksiyonlarını vade, bakiye ve limit durumuna göre sıraladım.
                </p>
              </div>
              <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
                <ListChecks size={21} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-card/80 px-3 py-2 ring-1 ring-border/70">
                <p className="font-bold uppercase text-muted-foreground">Ay sonu</p>
                <p className={`finance-value mt-1 truncate text-sm font-extrabold ${cashIsPositive ? 'text-success' : 'text-destructive'}`}>
                  {formatCurrency(cashFlow.projectedCash)}
                </p>
              </div>
              <div className="rounded-lg bg-card/80 px-3 py-2 ring-1 ring-border/70">
                <p className="font-bold uppercase text-muted-foreground">Sıradaki</p>
                <p className="mt-1 truncate text-sm font-extrabold text-foreground">{primaryAction.cta}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="grid gap-2 min-[720px]:grid-cols-2">
              {visibleActions.map((action) => (
                <FocusActionCard key={action.id} action={action} />
              ))}
            </div>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Aksiyonları daralt' : `Tüm aksiyonları göster (${actions.length})`}
              </button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FocusActionCard({ action }: { action: FocusAction }) {
  const Icon = {
    alert: AlertTriangle,
    calendar: CalendarDays,
    card: CreditCard,
    check: CheckCircle2,
    health: ShieldCheck,
    loan: Landmark,
  }[action.icon]
  const toneClass = {
    emerald: 'border-success/20 bg-card text-foreground ring-success/15 hover:border-success/35',
    amber: 'border-warning/25 bg-card text-foreground ring-warning/15 hover:border-warning/40',
    rose: 'border-destructive/20 bg-card text-foreground ring-destructive/15 hover:border-destructive/35',
    indigo: 'border-info/20 bg-card text-foreground ring-info/15 hover:border-info/35',
    stone: 'border-border bg-card text-foreground ring-border/70 hover:border-muted-foreground/35',
  }[action.tone]
  const iconClass = {
    emerald: 'bg-success/10 text-success',
    amber: 'bg-warning/12 text-warning',
    rose: 'bg-destructive/10 text-destructive',
    indigo: 'bg-info/10 text-info',
    stone: 'bg-muted text-muted-foreground',
  }[action.tone]

  return (
    <Link
      to={action.to}
      className={`group flex min-w-0 flex-col justify-between rounded-lg border p-3 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${toneClass}`}
    >
      <div className="flex items-start gap-3">
        <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${iconClass}`}>
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-extrabold leading-snug">{action.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{action.description}</p>
        </div>
      </div>
      <span className="mt-3 inline-flex items-center text-xs font-black uppercase tracking-normal text-muted-foreground group-hover:text-foreground">
        {action.cta}
        <ArrowUpRight className="ml-1 size-3.5" />
      </span>
    </Link>
  )
}


function SpendingRadarPanel({ expenses }: { expenses: CardExpense[] }) {
  const { anomalies, recurring } = useMemo(() => detectSpendingAnomalies(expenses), [expenses])

  const hasContent = anomalies.length > 0 || recurring.length > 0
  if (!hasContent) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Harcama radari</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Ortalamayı aşan kategoriler ve tekrar eden giderler.</p>
          </div>
          <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-500" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        {anomalies.slice(0, 3).map((anomaly) => (
          <div key={anomaly.category} className="rounded-lg bg-amber-50/70 px-3 py-2 ring-1 ring-amber-200/60 dark:bg-amber-950/20 dark:ring-amber-900/40">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-bold text-amber-900 dark:text-amber-100">{anomaly.category}</p>
              <span className="shrink-0 rounded-md bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                +{Math.round((anomaly.ratio - 1) * 100)}%
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/70">
              Bu ay {formatCurrency(anomaly.currentMonth)} · ort. {formatCurrency(anomaly.threeMonthAvg)}
            </p>
          </div>
        ))}
        {recurring.slice(0, 3).map((item) => (
          <div key={item.description} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{item.description}</p>
              <p className="text-[11px] text-muted-foreground">{item.monthCount} ay tekrar · {item.category}</p>
            </div>
            <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">{formatCurrency(item.amount)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function FinancialHealthPanel({ health, goalProgress }: { health: FinancialHealthSummary; goalProgress: GoalProgressSummary }) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/25 dark:text-emerald-100 dark:ring-emerald-900',
    amber: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/25 dark:text-amber-100 dark:ring-amber-900',
    rose: 'bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-950/25 dark:text-rose-100 dark:ring-rose-900',
  }[health.tone]
  const scoreTone = health.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : health.tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'
  const Icon = health.tone === 'rose' ? AlertTriangle : ShieldCheck

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Finansal sağlık</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Borç, nakit, limit ve hedef dengesi.</p>
          </div>
          <Badge variant={health.tone === 'rose' ? 'destructive' : 'secondary'}>{health.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-1">
        <div className={`rounded-lg p-3 ring-1 ${toneClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase opacity-75">Skor</p>
              <p className={`mt-1 text-2xl font-black tabular-nums ${scoreTone}`}>{health.score}/100</p>
            </div>
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-card/70">
              <Icon size={19} />
            </div>
          </div>
          <Progress value={health.score} className="mt-3 h-1.5" />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{health.description}</p>
        {goalProgress.nextGoalName ? (
          <div className="rounded-lg bg-muted/55 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{goalProgress.nextGoalName}</span>
            <span> için aylık {formatCurrency(goalProgress.nextGoalMonthlyNeed)} gerekebilir.</span>
          </div>
        ) : null}
        <ul className="space-y-1.5">
          {health.factors.slice(0, 3).map((factor) => (
            <li key={factor} className="flex gap-2 text-xs leading-5 text-muted-foreground">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/70" />
              <span>{factor}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}


function CashFlowPanel({ cashFlow }: { cashFlow: CashFlowSummary }) {
  const outflowRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : 0
  const isPositive = cashFlow.netFlow >= 0

  // Build chart data from cashFlow breakdown
  const chartData: CashFlowPoint[] = cashFlow.income > 0 || cashFlow.outflow > 0 ? [
    {
      label: 'Gelir',
      income: cashFlow.income,
      outflow: 0,
      net: cashFlow.income,
    },
    {
      label: 'Kart',
      income: 0,
      outflow: cashFlow.cardOutflow,
      net: -cashFlow.cardOutflow,
    },
    {
      label: 'Kredi',
      income: 0,
      outflow: cashFlow.loanOutflow,
      net: -cashFlow.loanOutflow,
    },
    {
      label: 'Fatura',
      income: 0,
      outflow: cashFlow.paymentOutflow,
      net: -cashFlow.paymentOutflow,
    },
    {
      label: 'Net',
      income: Math.max(0, cashFlow.netFlow),
      outflow: Math.max(0, -cashFlow.netFlow),
      net: cashFlow.netFlow,
    },
  ] : []

  return (
    <Card variant="default" className="border-border/70">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="inline-flex items-center gap-1.5">
              Aylık nakit akışı
              <HelpTooltip title="Aylık nakit akışı" content={dashboardHelp.cashFlow} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{cashFlow.monthLabel}</p>
          </div>
          <Badge variant={isPositive ? 'success' : 'destructive'}>
            {isPositive ? 'Artıda' : 'Açık var'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-3">
        {/* Summary pills */}
        <div className="grid grid-cols-3 gap-2">
          <CashFlowMetric label="Gelir" value={formatCurrency(cashFlow.income)} tone="emerald" />
          <CashFlowMetric label="Çıkış" value={formatCurrency(cashFlow.outflow)} tone="rose" />
          <CashFlowMetric label="Ay sonu" value={formatCurrency(cashFlow.projectedCash)} tone={cashFlow.projectedCash >= 0 ? 'emerald' : 'rose'} />
        </div>

        {/* Area chart */}
        {chartData.length > 0 && (
          <div className="rounded-xl bg-muted/20 p-2">
            <CashFlowChart data={chartData} height={180} />
          </div>
        )}

        {/* Outflow rate */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Gelire göre çıkış</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">%{Math.round(outflowRate)}</span>
          </div>
          <Progress value={outflowRate} autoColor size="default" />
        </div>

        {/* Detail grid */}
        <div className="grid gap-1.5 text-xs text-muted-foreground min-[430px]:grid-cols-2">
          <span>🏦 Kart: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.cardOutflow)}</span></span>
          <span>📋 Kredi: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.loanOutflow)}</span></span>
          <span>🧾 Fatura: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.paymentOutflow)}</span></span>
          <span>👤 Kişisel: <span className="font-mono font-medium text-foreground">{formatCurrency(cashFlow.debtOutflow)}</span></span>
          {cashFlow.receivableIncome > 0 ? (
            <span>📥 Tahsilat: <span className="font-mono font-medium text-success">{formatCurrency(cashFlow.receivableIncome)}</span></span>
          ) : null}
        </div>

        <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
          <p className="text-xs text-muted-foreground">
            Hesap nakdi {formatCurrency(cashFlow.cashAssets)} · {cashFlow.recurringPayments} aylık ödeme
          </p>
          <p className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${isPositive ? 'text-success' : 'text-destructive'}`}>
            Net akış: {cashFlow.netFlow >= 0 ? '+' : ''}{formatCurrency(cashFlow.netFlow)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

type CashFlowCalendarGroup = {
  dayKey: string
  dateLabel: string
  amount: number
  count: number
  kinds: Set<UpcomingItem['kind']>
  cashAfter: number
  items: UpcomingItem[]
}

function buildCashFlowCalendarGroups(items: UpcomingItem[], startingCash: number): CashFlowCalendarGroup[] {
  const groups = new Map<string, Omit<CashFlowCalendarGroup, 'cashAfter'>>()

  for (const item of items) {
    const dayKey = new Date(item.sortTime).toLocaleDateString('sv-SE')
    const current = groups.get(dayKey)
    const nextItems = [...(current?.items ?? []), item]
    groups.set(dayKey, {
      dayKey,
      dateLabel: formatDate(dayKey),
      amount: roundMoney((current?.amount ?? 0) + item.amount),
      count: nextItems.length,
      kinds: new Set([...(current?.kinds ?? []), item.kind]),
      items: nextItems,
    })
  }

  let runningCash = startingCash
  return Array.from(groups.values())
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    .map((group) => {
      runningCash = roundMoney(runningCash - group.amount)
      return { ...group, cashAfter: runningCash }
    })
}

function kindLabel(kind: UpcomingItem['kind']) {
  if (kind === 'payment') return 'Ödeme'
  if (kind === 'card') return 'Kart'
  if (kind === 'loan') return 'Kredi'
  return 'Borç'
}

function CashFlowCalendarPanel({ items, cashFlow }: { items: UpcomingItem[]; cashFlow: CashFlowSummary }) {
  const [showAll, setShowAll] = useState(false)
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const groups = useMemo(() => buildCashFlowCalendarGroups(items, cashFlow.cashAssets), [cashFlow.cashAssets, items])
  const visibleGroups = showAll ? groups : groups.slice(0, 4)
  const selectedGroup = visibleGroups.find((group) => group.dayKey === selectedDayKey) ?? visibleGroups[0] ?? null
  const totalUpcoming = sum(items, (item) => item.amount)
  const lowestCash = groups.reduce((lowest, group) => Math.min(lowest, group.cashAfter), cashFlow.cashAssets)

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Nakit takvimi</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Önümüzdeki {UPCOMING_DAYS} gün için günlük ödeme yoğunluğu.</p>
          </div>
          <Badge variant={lowestCash < 0 ? 'destructive' : 'secondary'}>
            {groups.length > 0 ? `${groups.length} gün · ${formatCurrency(totalUpcoming)}` : 'Takvim temiz'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {groups.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg bg-success/10 px-3 py-3 text-sm text-success">
            <CheckCircle2 className="size-5 shrink-0" />
            <span>Yaklaşan ödeme yok; bu dönem nakit takvimi sakin görünüyor.</span>
          </div>
        ) : (
          <>
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleGroups.map((group) => {
                const cashTone = group.cashAfter < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'
                const isSelected = selectedGroup?.dayKey === group.dayKey

                return (
                  <button
                    key={group.dayKey}
                    type="button"
                    onClick={() => setSelectedDayKey(group.dayKey)}
                    aria-pressed={isSelected}
                    className={`rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? 'border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200 dark:border-emerald-900/80 dark:bg-emerald-950/25 dark:ring-emerald-900/70'
                        : 'border-border bg-card/70 hover:bg-muted/45'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-foreground">{group.dateLabel}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {Array.from(group.kinds).map(kindLabel).join(' · ')} · {group.count} kayıt
                        </p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-rose-50 px-2 py-1 text-xs font-black tabular-nums text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                        {formatCurrency(group.amount)}
                      </span>
                    </div>
                    <p className={`mt-3 text-xs font-bold tabular-nums ${cashTone}`}>Bu gün sonrası tahmini nakit: {formatCurrency(group.cashAfter)}</p>
                  </button>
                )
              })}
            </div>
            {selectedGroup ? (
              <div className="rounded-lg border border-primary/15 bg-primary/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-emerald-950 dark:text-emerald-50">{selectedGroup.dateLabel}</p>
                    <p className="mt-1 text-xs text-emerald-900/70 dark:text-emerald-100/70">
                      {selectedGroup.count} kayıt · toplam {formatCurrency(selectedGroup.amount)}
                    </p>
                  </div>
                  <Badge variant={selectedGroup.cashAfter < 0 ? 'destructive' : 'secondary'}>
                    Sonra {formatCurrency(selectedGroup.cashAfter)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  {selectedGroup.items.map((item) => (
                    <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-card/80 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{item.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{kindLabel(item.kind)}</p>
                      </div>
                      <span className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-100 px-2 py-1 text-xs font-black tabular-nums text-emerald-900 dark:bg-emerald-900/45 dark:text-emerald-100">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {groups.length > 4 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/55 px-3 py-2 text-xs font-black text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Takvimi daralt' : `Tüm günleri göster (${groups.length})`}
              </button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SmartInsightsPanel({ insights }: { insights: SmartInsight[] }) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100',
    amber: 'border-amber-200 bg-amber-50/75 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100',
    rose: 'border-rose-200 bg-rose-50/75 text-rose-950 dark:border-rose-900 dark:bg-rose-950/25 dark:text-rose-100',
    stone: 'border-border bg-card text-foreground',
  }
  const iconClass = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
    stone: 'bg-muted text-muted-foreground',
  }

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Akıllı uyarılar</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Bu ay karar vermeyi hızlandıran kısa finans sinyalleri.</p>
          </div>
          <Lightbulb className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-2 min-[560px]:grid-cols-2">
        {insights.map((insight) => {
          const Icon = insight.tone === 'rose' ? AlertTriangle : insight.tone === 'emerald' ? ShieldCheck : Lightbulb

          return (
            <article key={insight.title} className={`rounded-lg border p-3 ${toneClass[insight.tone]}`}>
              <div className="flex items-start gap-3">
                <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${iconClass[insight.tone]}`}>
                  <Icon size={17} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold leading-snug">{insight.title}</h3>
                  <p className="mt-1 text-xs leading-5 opacity-75">{insight.description}</p>
                </div>
              </div>
            </article>
          )
        })}
      </CardContent>
    </Card>
  )
}

function parseScenarioAmount(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function ScenarioSimulator({ cashFlow, netWorth }: { cashFlow: CashFlowSummary; netWorth: number }) {
  const [extraIncome, setExtraIncome] = useState('')
  const [debtPayment, setDebtPayment] = useState('')
  const [plannedSpend, setPlannedSpend] = useState('')
  const [goalTransfer, setGoalTransfer] = useState('')
  const income = parseScenarioAmount(extraIncome)
  const debt = parseScenarioAmount(debtPayment)
  const spend = parseScenarioAmount(plannedSpend)
  const transfer = parseScenarioAmount(goalTransfer)
  const projectedCash = cashFlow.projectedCash + income - debt - spend - transfer
  const projectedNetWorth = netWorth + income - spend
  const cashTone = projectedCash >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
  const hasScenario = income + debt + spend + transfer > 0

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Senaryo dene</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Bu ay için hızlı nakit ve net durum provası.</p>
          </div>
          <Calculator className="text-emerald-700 dark:text-emerald-300" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="grid grid-cols-2 gap-2">
          <ScenarioInput label="Ek gelir" value={extraIncome} onChange={setExtraIncome} />
          <ScenarioInput label="Ek borç öde" value={debtPayment} onChange={setDebtPayment} />
          <ScenarioInput label="Planlı harcama" value={plannedSpend} onChange={setPlannedSpend} />
          <ScenarioInput label="Hedefe ayır" value={goalTransfer} onChange={setGoalTransfer} />
        </div>
        <div className="rounded-lg bg-muted/55 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Senaryo ay sonu nakit</span>
            <strong className={`shrink-0 tabular-nums ${cashTone}`}>{formatCurrency(projectedCash)}</strong>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Tahmini net durum</span>
            <strong className="shrink-0 tabular-nums text-foreground">{formatCurrency(projectedNetWorth)}</strong>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {hasScenario
            ? 'Ek borç ödeme ve hedef transferi nakdi azaltır; net durumu yalnızca ek gelir ve yeni harcama değiştirir.'
            : 'Alanlara tutar girerek ay sonu projeksiyonunu anında oynatabilirsin.'}
        </p>
      </CardContent>
    </Card>
  )
}

function ScenarioInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-bold uppercase text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        placeholder="0"
        className="mt-1 w-full rounded-lg border border-input bg-background/85 px-2.5 py-2 text-sm font-semibold tabular-nums text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/15"
      />
    </label>
  )
}


function PeriodDebtTotalsPanel({ cashFlow }: { cashFlow: CashFlowSummary }) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="inline-flex items-center gap-1.5">
          Dönem borcu toplamları
          <HelpTooltip title="Dönem borcu toplamları" content={dashboardHelp.periodDebt} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 pt-0">
        <CashFlowMetric label="Kart borcu" value={formatCurrency(cashFlow.cardStatementDebt)} tone="rose" />
        <CashFlowMetric label="Kredi taksidi" value={formatCurrency(cashFlow.loanOutflow)} tone="rose" />
        <CashFlowMetric label="Fatura/ödeme" value={formatCurrency(cashFlow.paymentOutflow)} tone="rose" />
        <CashFlowMetric label="Kişisel borç" value={formatCurrency(cashFlow.debtOutflow)} tone="rose" />
      </CardContent>
    </Card>
  )
}

function NextMonthLoadPanel({ load }: { load: MonthlyLoadSummary }) {
  const loanTotal = load.loanInstallments + load.legacyLoanInstallments
  const rows = [
    { label: 'Fatura/ödeme', value: load.payments },
    { label: 'Açık ekstre', value: load.cardStatements },
    { label: 'Kart taksitleri', value: load.cardInstallments },
    { label: 'Kredi taksidi', value: loanTotal },
    { label: 'Kişisel borç', value: load.personalDebts },
  ]

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="inline-flex items-center gap-1.5">
              Gelecek ay yükü
              <HelpTooltip title="Gelecek ay yükü" content={dashboardHelp.nextMonthLoad} />
            </CardTitle>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{load.monthLabel}</p>
          </div>
          <Badge variant={load.total > 0 ? 'secondary' : 'outline'}>{formatCurrency(load.total)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="rounded-lg bg-destructive/10 px-3 py-3">
          <p className="text-[11px] font-bold uppercase text-rose-700 dark:text-rose-300">Toplam planlı çıkış</p>
          <p className="mt-1 whitespace-nowrap text-[clamp(1rem,4vw,1.55rem)] font-black tabular-nums text-rose-800 dark:text-rose-200">
            {formatCurrency(load.total)}
          </p>
        </div>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
          {rows.map((row) => (
            <CashFlowMetric key={row.label} label={row.label} value={formatCurrency(row.value)} tone="rose" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function upcomingDayLabel(sortTime: number) {
  const remaining = daysUntil(new Date(sortTime))
  if (remaining === null) return 'Tarih yok'
  if (remaining < 0) return `${Math.abs(remaining)} gün geçti`
  if (remaining === 0) return 'Bugün'
  if (remaining === 1) return 'Yarın'
  return `${remaining} gün kaldı`
}

function UpcomingAlertPanel({ items }: { items: UpcomingItem[] }) {
  const [showAll, setShowAll] = useState(false)

  if (items.length === 0) return null

  const urgentCount = items.filter((item) => {
    const remaining = daysUntil(new Date(item.sortTime))
    return remaining !== null && remaining <= 7
  }).length
  const visibleItems = showAll ? items : items.slice(0, 3)
  const hiddenCount = Math.max(0, items.length - 3)

  return (
    <Card className="min-w-0 border-amber-200 bg-amber-50/70 py-0 shadow-sm ring-1 ring-amber-200/80 dark:border-amber-900 dark:bg-amber-950/20 dark:ring-amber-900/70 lg:col-span-12">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 min-[760px]:flex-row min-[760px]:items-start min-[760px]:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-bold uppercase text-amber-800 dark:text-amber-200">Ödeme alarmı</p>
              <Badge variant={urgentCount > 0 ? 'destructive' : 'secondary'}>{urgentCount > 0 ? `${urgentCount} yakın vade` : `${items.length} kayıt`}</Badge>
            </div>
            <p className="mt-1 text-sm text-amber-900/75 dark:text-amber-100/75">
              Yaklaşan kart, kredi, fatura ve kişisel borç vadelerini kaçırmamak için öne aldım.
            </p>
          </div>
          <div className="min-w-0 flex-1 min-[760px]:max-w-xl">
            <div className={`grid gap-2 ${showAll ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>
              {visibleItems.map((item) => (
                <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-card/80 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.date} · {upcomingDayLabel(item.sortTime)}
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold tabular-nums text-amber-900 dark:bg-amber-900/45 dark:text-amber-100">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((current) => !current)}
                aria-expanded={showAll}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-card/70 px-3 py-2 text-xs font-bold text-amber-900 shadow-sm transition hover:bg-card dark:border-amber-900/70 dark:text-amber-100"
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Daralt' : `Tümünü göster (${items.length})`}
              </button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CurrentDebtTotalsPanel({
  totalDebt,
  cardDebt,
  loanDebt,
  personalDebt,
  paymentDebt,
}: {
  totalDebt: number
  cardDebt: number
  loanDebt: number
  personalDebt: number
  paymentDebt: number
}) {
  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-2">
        <CardTitle className="inline-flex items-center gap-1.5">
          Güncel borç toplamları
          <HelpTooltip title="Güncel borç toplamları" content={dashboardHelp.currentDebt} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2 pt-0">
        <CashFlowMetric label="Toplam borç" value={formatCurrency(totalDebt)} tone="rose" />
        <CashFlowMetric label="Kart borcu" value={formatCurrency(cardDebt)} tone="rose" />
        <CashFlowMetric label="Kredi borcu" value={formatCurrency(loanDebt)} tone="rose" />
        <CashFlowMetric label="Kişisel borç" value={formatCurrency(personalDebt)} tone="rose" />
        <CashFlowMetric label="Fatura/ödeme" value={formatCurrency(paymentDebt)} tone="rose" />
      </CardContent>
    </Card>
  )
}

function CashFlowMetric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'

  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-2.5 py-2 min-[430px]:px-3">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap text-[clamp(0.7rem,3vw,1rem)] font-extrabold leading-tight tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  )
}

function MetricTile({
  label,
  value,
  icon,
  tone,
  help,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tone: 'emerald' | 'rose' | 'amber' | 'indigo' | 'stone'
  help?: HelpTooltipContent
}) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900',
    stone: 'bg-muted text-muted-foreground ring-border',
  }[tone]

  return (
    <Card size="sm" className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
            {help ? <HelpTooltip title={label} content={help} /> : null}
          </div>
          <p className="mt-1 whitespace-nowrap text-[clamp(0.78rem,3.3vw,1.25rem)] font-extrabold leading-tight tabular-nums text-foreground">{value}</p>
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${toneClass}`}>{icon}</div>
      </CardContent>
    </Card>
  )
}

function CreditLimitSection({ groups, totalUsageRate }: { groups: CreditLimitGroup[]; totalUsageRate: number }) {
  if (groups.length === 0) return null

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="inline-flex items-center gap-1.5">
            Kart limitleri
            <HelpTooltip title="Kart limitleri" content={dashboardHelp.creditLimit} />
          </CardTitle>
          <Badge variant="secondary">%{Math.round(totalUsageRate)} kullanım</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-1">
        {groups.slice(0, 3).map((group) => (
          <div key={group.key} className="rounded-lg bg-muted/55 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{group.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {group.cards.length} kart · kalan {formatCurrency(group.available)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-extrabold tabular-nums text-foreground">{formatCurrency(group.debt)}</p>
            </div>
            <Progress value={group.usageRate} className="mt-3 h-1.5" />
            <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>Limit {formatCurrency(group.limit)}</span>
              <span>%{Math.round(group.usageRate)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function PulseCard({ title, label, value, description, icon, tone }: { title: string; label: string; value: string; description: string; icon: React.ReactNode; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/30' : 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/30'

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${toneClass}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-muted-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-extrabold tabular-nums text-foreground">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function SalaryPulse({ trend }: { trend: ReturnType<typeof getSalaryTrend> }) {
  if (!trend.current) {
    return (
      <PulseCard
        title="Maaş trendi"
        label="Henüz kayıt yok"
        value="-"
        description="Maaş geçmişi varlıklara dahil edilmez"
        icon={<TrendingUp />}
        tone="emerald"
      />
    )
  }

  const trendLabel = trend.previous
    ? `${trend.difference >= 0 ? '+' : ''}${formatCurrency(trend.difference)} · ${trend.percentage >= 0 ? '+' : ''}${trend.percentage.toFixed(1)}%`
    : 'İlk maaş kaydı'

  return (
    <PulseCard
      title="Maaş trendi"
      label={formatDate(trend.current.effective_date)}
      value={formatCurrency(trend.current.amount)}
      description={trendLabel}
      icon={<TrendingUp />}
      tone="emerald"
    />
  )
}

function HistorySection({ rows }: { rows: TransactionHistory[] }) {
  const [activeType, setActiveType] = useState<TransactionHistoryType | 'all'>('all')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const filteredRows = (activeType === 'all' ? rows : rows.filter((row) => row.type === activeType)).filter((row) =>
    normalizedQuery ? `${row.title} ${row.note ?? ''} ${row.type}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery) : true,
  )
  const groupedRows = groupHistoryRows(filteredRows.slice(0, 40))

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] ring-1 ring-border/80">
      <CardHeader className="pb-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Son güncellemeler</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Son 3 ay işlem geçmişi ve hesap hareketleri.</p>
          </div>
          <Badge variant="secondary">{filteredRows.length} kayıt</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Geçmişte ara"
            className="pl-9 text-sm"
          />
        </label>
        <div className="finance-scrollbar flex gap-2 overflow-x-auto pb-1">
          {historyFilters.map((filter) => {
            const isActive = activeType === filter.value

            return (
              <button
                key={filter.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActiveType(filter.value)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
              >
                {filter.label}
              </button>
            )
          })}
        </div>
      {rows.length === 0 ? (
        <EmptyState title="İşlem geçmişi yok" description="Planlı ödemeler, transferler ve borç kapatma işlemleri burada görünecek." />
      ) : filteredRows.length === 0 ? (
        <EmptyState title="Bu filtrede işlem yok" description="Farklı bir işlem türü seçerek geçmiş kayıtları görebilirsiniz." />
      ) : (
        <div className="space-y-5">
          {groupedRows.map((group) => (
            <section key={group.label} className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="shrink-0 text-xs font-bold uppercase text-muted-foreground">{group.label}</h3>
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
              </div>
              <div className="space-y-2">
                {group.rows.map((row) => (
                  <article key={row.id} className="flex gap-3 rounded-lg border border-border/75 bg-card/80 p-3 shadow-sm">
                    <div className={`mt-1 size-2.5 shrink-0 rounded-full ${historyDotClass(row.type)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-foreground">{row.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatHistoryDate(row.occurred_at)}</p>
                        </div>
                        {row.amount !== null ? (
                          <span className="finance-value shrink-0 rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-foreground">
                            {formatCurrency(row.amount)}
                          </span>
                        ) : null}
                      </div>
                      {row.note ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{row.note}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      </CardContent>
    </Card>
  )
}

function groupHistoryRows(rows: TransactionHistory[]) {
  const groups = new Map<string, TransactionHistory[]>()

  for (const row of rows) {
    const label = formatHistoryDay(row.occurred_at)
    groups.set(label, [...(groups.get(label) ?? []), row])
  }

  return Array.from(groups, ([label, groupRows]) => ({ label, rows: groupRows }))
}

function formatHistoryDay(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toLocaleDateString('sv-SE') === today.toLocaleDateString('sv-SE')) return 'Bugün'
  if (date.toLocaleDateString('sv-SE') === yesterday.toLocaleDateString('sv-SE')) return 'Dün'

  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function historyDotClass(type: TransactionHistoryType) {
  const classes: Record<TransactionHistoryType, string> = {
    payment: 'bg-amber-500',
    transfer: 'bg-sky-500',
    loan: 'bg-rose-500',
    debt: 'bg-violet-500',
    card: 'bg-emerald-500',
  }

  return classes[type]
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
