import type { User } from '@supabase/supabase-js'
import { ArrowDownRight, ArrowUpRight, CalendarDays, CreditCard, Landmark, ReceiptText, Sparkles, Trash2, TrendingDown, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import type { Asset, Card as FinanceCard, Debt, DismissedUpcomingItem, Loan, LoanInstallment, Payment, SalaryHistory, TransactionHistory, UpcomingDismissalSource } from '../types/database'
import { daysUntil, endOfMonth, formatDate, isDateInMonth, isUpcomingDate, monthlyOccurrenceDate, nextMonthlyDate, startOfMonth } from '../utils/date'
import { formatCurrency } from '../utils/formatCurrency'
import { EmptyState } from '../components/EmptyState'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { Separator } from '../components/ui/separator'
import { Skeleton } from '../components/ui/skeleton'

type DashboardData = {
  assets: Asset[]
  cards: FinanceCard[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  transactionHistory: TransactionHistory[]
  dismissedUpcomingItems: DismissedUpcomingItem[]
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
  dismissedUpcomingItems: [],
}

const UPCOMING_DAYS = 30

type UpcomingItem = {
  id: string
  recordId: string
  source: UpcomingDismissalSource
  title: string
  value: string
  date: string
  sortTime: number
}

type CreditLimitGroup = {
  key: string
  label: string
  limit: number
  debt: number
  available: number
  usageRate: number
  cards: FinanceCard[]
}

type CashFlowSummary = {
  monthLabel: string
  cashAssets: number
  income: number
  outflow: number
  netFlow: number
  projectedCash: number
  recurringPayments: number
  cardOutflow: number
  loanOutflow: number
  paymentOutflow: number
  debtOutflow: number
}

function sum<T>(rows: T[], selector: (row: T) => number) {
  return rows.reduce((total, row) => total + selector(row), 0)
}

function totalCreditLimit(cards: FinanceCard[]) {
  const limitsByGroup = new Map<string, number>()

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
    const groupKey = creditLimitGroupKey(card)
    limitsByGroup.set(groupKey, Math.max(limitsByGroup.get(groupKey) ?? 0, card.credit_limit))
  }

  return Array.from(limitsByGroup.values()).reduce((total, limit) => total + limit, 0)
}

function creditLimitGroupKey(card: FinanceCard) {
  return card.limit_group_name?.trim() || card.id
}

function buildCreditLimitGroups(cards: FinanceCard[]): CreditLimitGroup[] {
  const groups = new Map<string, FinanceCard[]>()

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
    const key = creditLimitGroupKey(card)
    groups.set(key, [...(groups.get(key) ?? []), card])
  }

  return Array.from(groups, ([key, groupCards]) => {
    const limit = Math.max(...groupCards.map((card) => card.credit_limit), 0)
    const debt = sum(groupCards, (card) => card.debt_amount)
    const usageRate = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0
    const groupName = groupCards.find((card) => card.limit_group_name?.trim())?.limit_group_name?.trim()

    return {
      key,
      label: groupName || groupCards[0]?.card_name || 'Kart grubu',
      limit,
      debt,
      available: Math.max(0, limit - debt),
      usageRate,
      cards: groupCards,
    }
  }).sort((a, b) => b.debt - a.debt)
}

function getSalaryTrend(rows: SalaryHistory[]) {
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  const current = ordered.at(-1) ?? null
  const previous = ordered.at(-2) ?? null

  if (!current || !previous || previous.amount <= 0) return { current, previous, difference: 0, percentage: 0 }

  const difference = current.amount - previous.amount
  return {
    current,
    previous,
    difference,
    percentage: (difference / previous.amount) * 100,
  }
}

function getCurrentSalary(rows: SalaryHistory[]) {
  const today = new Date().toLocaleDateString('sv-SE')
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  return ordered.filter((row) => row.effective_date <= today).at(-1) ?? ordered.at(-1) ?? null
}

function paymentOccurrenceInMonth(payment: Payment, month = new Date()) {
  if (payment.status !== 'bekliyor') return null

  if (payment.recurrence === 'monthly') {
    const occurrence = monthlyOccurrenceDate(payment.recurrence_day, month)
    if (!occurrence) return null

    const dueDate = new Date(`${payment.due_date}T00:00:00`)
    const endDate = payment.recurrence_end_date ? new Date(`${payment.recurrence_end_date}T00:00:00`) : null
    if (occurrence < dueDate) return null
    if (endDate && occurrence > endDate) return null
    return occurrence
  }

  return isDateInMonth(payment.due_date, month) ? new Date(`${payment.due_date}T00:00:00`) : null
}

function cardMonthlyPaymentAmount(card: FinanceCard) {
  return card.statement_debt_amount
}

function buildMonthlyCashFlow(data: DashboardData): CashFlowSummary {
  const month = new Date()
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(month)
  const currentSalary = getCurrentSalary(data.salaryHistory)
  const cashAssets = sum(
    data.assets.filter((asset) => asset.category === 'Nakit'),
    (asset) => asset.estimated_value_try,
  )
  const openDebts = data.debts.filter((debt) => debt.status === 'açık')
  const receivableIncome = sum(
    openDebts.filter((debt) => debt.direction === 'borç_verdim' && isDateInMonth(debt.due_date, month)),
    (debt) => debt.estimated_value_try,
  )
  const paymentOutflow = sum(
    data.payments.filter((payment) => paymentOccurrenceInMonth(payment, month)),
    (payment) => payment.amount,
  )
  const recurringPayments = data.payments.filter((payment) => payment.recurrence === 'monthly' && payment.status === 'bekliyor').length
  const cardOutflow = sum(
    data.cards.filter((card) => {
      const dueDate = monthlyOccurrenceDate(card.due_day, month)
      return card.card_type === 'kredi_karti' && cardMonthlyPaymentAmount(card) > 0 && dueDate !== null && dueDate >= monthStart && dueDate <= monthEnd
    }),
    cardMonthlyPaymentAmount,
  )
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
  const scheduledLoanOutflow = sum(
    data.loanInstallments.filter((installment) => installment.status === 'bekliyor' && isDateInMonth(installment.due_date, month)),
    (installment) => installment.amount,
  )
  const legacyLoanOutflow = sum(
    data.loans.filter((loan) => {
      const dueDate = monthlyOccurrenceDate(loan.installment_day, month)
      return !plannedLoanIds.has(loan.id) && loan.status === 'active' && loan.remaining_installments > 0 && dueDate !== null && dueDate >= monthStart && dueDate <= monthEnd
    }),
    (loan) => loan.monthly_payment,
  )
  const loanOutflow = scheduledLoanOutflow + legacyLoanOutflow
  const debtOutflow = sum(
    openDebts.filter((debt) => debt.direction === 'borç_aldım' && isDateInMonth(debt.due_date, month)),
    (debt) => debt.estimated_value_try,
  )
  const income = (currentSalary?.amount ?? 0) + receivableIncome
  const outflow = paymentOutflow + cardOutflow + loanOutflow + debtOutflow
  const netFlow = income - outflow

  return {
    monthLabel,
    cashAssets,
    income,
    outflow,
    netFlow,
    projectedCash: cashAssets + netFlow,
    recurringPayments,
    cardOutflow,
    loanOutflow,
    paymentOutflow,
    debtOutflow,
  }
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

    const historyStart = new Date()
    historyStart.setMonth(historyStart.getMonth() - 3)

    const [assets, cards, loans, loanInstallments, debts, payments, salaryHistory, transactionHistory, dismissedUpcomingItems] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('cards').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*'),
      supabase.from('debts').select('*'),
      supabase.from('payments').select('*'),
      supabase.from('salary_history').select('*').order('effective_date', { ascending: false }),
      supabase.from('transaction_history').select('*').gte('occurred_at', historyStart.toISOString()).order('occurred_at', { ascending: false }),
      supabase.from('dismissed_upcoming_items').select('*'),
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
      dismissedUpcomingItems.error,
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
      dismissedUpcomingItems: dismissedUpcomingItems.data ?? [],
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
    const totalAssets = sum(data.assets, (asset) => asset.estimated_value_try)
    const totalCreditCardDebt = sum(
      data.cards.filter((card) => card.card_type === 'kredi_karti'),
      (card) => card.debt_amount,
    )
    const totalSharedCreditLimit = totalCreditLimit(data.cards)
    const totalLoanDebt = sum(
      data.loans.filter((loan) => loan.status === 'active'),
      (loan) => loan.remaining_amount,
    )
    const totalLoanMonthlyPayment = sum(
      data.loans.filter((loan) => loan.status === 'active'),
      (loan) => loan.monthly_payment,
    )
    const openDebts = data.debts.filter((debt) => debt.status === 'açık')
    const totalPersonalDebts = sum(
      openDebts.filter((debt) => debt.direction === 'borç_aldım'),
      (debt) => debt.estimated_value_try,
    )
    const totalReceivables = sum(
      openDebts.filter((debt) => debt.direction === 'borç_verdim'),
      (debt) => debt.estimated_value_try,
    )
    const totalDebts = totalCreditCardDebt + totalLoanDebt + totalPersonalDebts
    const netWorth = totalAssets + totalReceivables - totalDebts
    const creditUsageRate = totalSharedCreditLimit > 0 ? Math.min(100, (totalCreditCardDebt / totalSharedCreditLimit) * 100) : 0
    const salaryTrend = getSalaryTrend(data.salaryHistory)
    const creditLimitGroups = buildCreditLimitGroups(data.cards)
    const cashFlow = buildMonthlyCashFlow(data)

    return {
      totalAssets,
      totalDebts,
      netWorth,
      totalCreditCardDebt,
      totalCreditLimit: totalSharedCreditLimit,
      creditUsageRate,
      creditLimitGroups,
      totalLoanDebt,
      totalLoanMonthlyPayment,
      totalPersonalDebts,
      totalReceivables,
      salaryTrend,
      cashFlow,
    }
  }, [data])

  const upcomingItems = useMemo(() => {
    const dismissedKeys = new Set(data.dismissedUpcomingItems.map((item) => item.item_key))
    const loansById = new Map(data.loans.map((loan) => [loan.id, loan]))
    const manualPayments = data.payments
      .filter((payment) => payment.status === 'bekliyor' && isUpcomingDate(payment.due_date, UPCOMING_DAYS))
      .map((payment) => ({
        id: `payment-${payment.id}`,
        recordId: payment.id,
        source: 'payment' as const,
        title: `Ödeme · ${payment.title}`,
        value: formatCurrency(payment.amount),
        date: formatDate(payment.due_date),
        sortTime: new Date(`${payment.due_date}T00:00:00`).getTime(),
      }))

    const creditCards = data.cards
      .filter((card) => card.card_type === 'kredi_karti' && card.due_day && cardMonthlyPaymentAmount(card) > 0)
      .map((card) => ({ card, dueDate: nextMonthlyDate(card.due_day) }))
      .filter((item) => {
        const remaining = daysUntil(item.dueDate)
        return remaining !== null && remaining >= 0 && remaining <= UPCOMING_DAYS
      })
      .map(({ card, dueDate }) => ({
        id: `card-${card.id}-${dateInputValue(dueDate)}`,
        recordId: card.id,
        source: 'card' as const,
        title: `Kart · ${card.bank_name} · ${card.card_name}`,
        value: formatCurrency(cardMonthlyPaymentAmount(card)),
        date: formatMonthDay(dueDate),
        sortTime: dueDate?.getTime() ?? 0,
      }))

    const loanInstallments = data.loanInstallments
      .filter((installment) => installment.status === 'bekliyor' && isUpcomingDate(installment.due_date, UPCOMING_DAYS))
      .map((installment) => {
        const loan = loansById.get(installment.loan_id)
        return {
          id: `loan-installment-${installment.id}`,
          recordId: installment.id,
          source: 'loan_installment' as const,
          title: loan ? `Kredi · ${loan.bank_name} · ${loan.loan_name}` : 'Kredi taksidi',
          value: formatCurrency(installment.amount),
          date: formatDate(installment.due_date),
          sortTime: new Date(`${installment.due_date}T00:00:00`).getTime(),
        }
      })

    const personalDebts = data.debts
      .filter((debt) => debt.direction === 'borç_aldım' && debt.status === 'açık' && isUpcomingDate(debt.due_date, UPCOMING_DAYS))
      .map((debt) => ({
        id: `debt-${debt.id}`,
        recordId: debt.id,
        source: 'debt' as const,
        title: `Borç · ${debt.person_name}`,
        value: formatCurrency(debt.estimated_value_try),
        date: formatDate(debt.due_date),
        sortTime: new Date(`${debt.due_date}T00:00:00`).getTime(),
      }))

    const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
    const legacyLoanInstallments = data.loans
      .filter((loan) => !plannedLoanIds.has(loan.id) && loan.status === 'active' && loan.installment_day && loan.remaining_installments > 0)
      .map((loan) => ({ loan, dueDate: nextMonthlyDate(loan.installment_day) }))
      .filter((item) => {
        const remaining = daysUntil(item.dueDate)
        return remaining !== null && remaining >= 0 && remaining <= UPCOMING_DAYS
      })
      .map(({ loan, dueDate }) => ({
        id: `loan-${loan.id}-${dateInputValue(dueDate)}`,
        recordId: loan.id,
        source: 'loan_installment' as const,
        title: `Kredi · ${loan.bank_name} · ${loan.loan_name}`,
        value: formatCurrency(loan.monthly_payment),
        date: formatMonthDay(dueDate),
        sortTime: dueDate?.getTime() ?? 0,
      }))

    return [...manualPayments, ...creditCards, ...loanInstallments, ...personalDebts, ...legacyLoanInstallments]
      .filter((item) => !dismissedKeys.has(item.id))
      .sort((a, b) => a.sortTime - b.sortTime)
      .slice(0, 10)
  }, [data.cards, data.debts, data.dismissedUpcomingItems, data.loanInstallments, data.loans, data.payments])

  async function dismissUpcomingItem(item: UpcomingItem) {
    if (!user) return

    const { error: dismissError } = await supabase.from('dismissed_upcoming_items').upsert(
      {
        user_id: user.id,
        item_key: item.id,
        source: item.source,
      },
      { onConflict: 'user_id,item_key' },
    )
    if (dismissError) {
      setError(dismissError.message)
      return
    }

    await loadDashboard()
  }

  if (loading) {
    return (
      <section className="flex flex-col gap-4">
        <Skeleton className="h-44 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-32 rounded-2xl" />
      </section>
    )
  }

  if (error) {
    return <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
  }

  return (
    <section className="flex flex-col gap-5">
      <WelcomePanel displayName={displayName} cashFlow={summary.cashFlow} />

      <NetWorthPanel
        netWorth={summary.netWorth}
        totalAssets={summary.totalAssets}
        totalDebts={summary.totalDebts}
        totalReceivables={summary.totalReceivables}
      />

      <CashFlowPanel cashFlow={summary.cashFlow} />

      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Toplam limit" value={formatCurrency(summary.totalCreditLimit)} icon={<CreditCard />} tone="indigo" />
        <MetricTile label="Kart borcu" value={formatCurrency(summary.totalCreditCardDebt)} icon={<ReceiptText />} tone="amber" />
        <MetricTile label="Kredi borcu" value={formatCurrency(summary.totalLoanDebt)} icon={<Landmark />} tone="rose" />
        <MetricTile label="Kredi ödemesi" value={formatCurrency(summary.totalLoanMonthlyPayment)} icon={<CalendarDays />} tone="stone" />
        <MetricTile label="Kişisel borç" value={formatCurrency(summary.totalPersonalDebts)} icon={<ArrowDownRight />} tone="rose" />
        <MetricTile label="Alacak" value={formatCurrency(summary.totalReceivables)} icon={<ArrowUpRight />} tone="emerald" />
      </div>

      <CreditLimitSection groups={summary.creditLimitGroups} totalUsageRate={summary.creditUsageRate} />

      <div className="grid gap-3 min-[520px]:grid-cols-2">
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

      <UpcomingSection title="Yaklaşan ödemeler">
        {upcomingItems.length === 0 ? (
          <EmptyState title="Yaklaşan ödeme yok" description="Önümüzdeki 30 gün için ödeme, kart günü veya kredi taksidi bulunmuyor." />
        ) : (
          upcomingItems.map((item) => (
            <ModernUpcomingRow key={item.id} item={item} onDismiss={dismissUpcomingItem} />
          ))
        )}
      </UpcomingSection>

      <HistorySection rows={data.transactionHistory} />
    </section>
  )
}

function dateInputValue(date: Date | null) {
  return date ? date.toLocaleDateString('sv-SE') : 'unknown'
}

function formatMonthDay(date: Date | null) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(date)
}

function getUserDisplayName(user: User | null) {
  const metadata = user?.user_metadata
  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : ''
  const name = typeof metadata?.name === 'string' ? metadata.name.trim() : ''

  return fullName || name
}

function WelcomePanel({ displayName, cashFlow }: { displayName: string; cashFlow: CashFlowSummary }) {
  const netFlowIsPositive = cashFlow.netFlow >= 0
  const signedNetFlow = `${netFlowIsPositive ? '+' : ''}${formatCurrency(cashFlow.netFlow)}`

  return (
    <Card className="relative overflow-hidden border-0 bg-emerald-950 py-0 text-white shadow-xl shadow-emerald-950/20 ring-1 ring-emerald-500/20">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(4,120,87,0.98),rgba(13,148,136,0.94)_46%,rgba(79,70,229,0.92))]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(120deg,rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.1)_1px,transparent_1px)] [background-size:22px_22px]" />
      <CardContent className="relative p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1.5 text-xs font-bold text-emerald-50 ring-1 ring-white/18">
              <Sparkles size={14} />
              Finans özeti hazır
            </div>
            <h2 className="break-words text-[clamp(1.8rem,7vw,2.65rem)] font-black leading-[0.98] tracking-normal">
              Hoş geldiniz{displayName ? ',' : ''}
              {displayName ? <span className="block text-emerald-100">{displayName}</span> : null}
            </h2>
            <p className="mt-3 max-w-md text-sm font-medium leading-6 text-white/78">
              {cashFlow.monthLabel} için nakit akışı, kartlar ve yaklaşan ödemeler tek ekranda.
            </p>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15 text-emerald-50 ring-1 ring-white/20">
            <TrendingUp size={22} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <WelcomeMetric label="Dönem" value={cashFlow.monthLabel} />
          <WelcomeMetric label="Net akış" value={signedNetFlow} tone={netFlowIsPositive ? 'positive' : 'negative'} />
          <WelcomeMetric label="Nakit" value={formatCurrency(cashFlow.cashAssets)} />
        </div>
      </CardContent>
    </Card>
  )
}

function WelcomeMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'positive' | 'negative' }) {
  const valueClass = {
    neutral: 'text-white',
    positive: 'text-emerald-100',
    negative: 'text-rose-100',
  }[tone]

  return (
    <div className="min-w-0 rounded-xl bg-white/12 px-3 py-2.5 ring-1 ring-white/14 backdrop-blur">
      <p className="truncate text-[10px] font-bold uppercase text-white/58">{label}</p>
      <p className={`mt-1 text-[clamp(0.72rem,3.4vw,0.92rem)] font-extrabold leading-tight tabular-nums [overflow-wrap:anywhere] ${valueClass}`}>
        {value}
      </p>
    </div>
  )
}

function UpcomingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-bold text-stone-950 dark:text-stone-50">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function NetWorthPanel({ netWorth, totalAssets, totalDebts, totalReceivables }: { netWorth: number; totalAssets: number; totalDebts: number; totalReceivables: number }) {
  const isPositive = netWorth >= 0
  const TrendIcon = isPositive ? TrendingUp : TrendingDown

  return (
    <Card className="border-emerald-200/70 bg-gradient-to-br from-emerald-700 to-emerald-900 py-0 text-white shadow-lg shadow-emerald-950/15 dark:border-emerald-900">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-emerald-100/80">Net durum</p>
            <p className="mt-2 break-words text-[clamp(1.9rem,8vw,2.7rem)] font-extrabold leading-none tabular-nums">
              {formatCurrency(netWorth)}
            </p>
          </div>
          <Badge className="shrink-0 bg-white/14 text-white ring-1 ring-white/20">
            <TrendIcon data-icon="inline-start" />
            {isPositive ? 'Pozitif' : 'Ekside'}
          </Badge>
        </div>
        <Separator className="my-4 bg-white/15" />
        <div className="grid grid-cols-3 gap-2 text-xs">
          <SummaryPill label="Varlık" value={formatCurrency(totalAssets)} />
          <SummaryPill label="Borç" value={formatCurrency(totalDebts)} />
          <SummaryPill label="Alacak" value={formatCurrency(totalReceivables)} />
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/10 px-2.5 py-2 ring-1 ring-white/10">
      <p className="truncate text-[11px] font-medium text-emerald-50/75">{label}</p>
      <p className="mt-1 whitespace-normal text-[0.72rem] font-bold leading-tight tabular-nums text-white [overflow-wrap:anywhere] min-[390px]:text-sm">
        {value}
      </p>
    </div>
  )
}

function CashFlowPanel({ cashFlow }: { cashFlow: CashFlowSummary }) {
  const outflowRate = cashFlow.income > 0 ? Math.min(100, (cashFlow.outflow / cashFlow.income) * 100) : 0
  const projectionTone = cashFlow.projectedCash >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Aylık nakit akışı</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{cashFlow.monthLabel}</p>
          </div>
          <Badge variant={cashFlow.netFlow >= 0 ? 'secondary' : 'destructive'}>
            {cashFlow.netFlow >= 0 ? 'Artıda' : 'Açık var'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <div className="grid grid-cols-3 gap-2">
          <CashFlowMetric label="Gelir" value={formatCurrency(cashFlow.income)} tone="emerald" />
          <CashFlowMetric label="Çıkış" value={formatCurrency(cashFlow.outflow)} tone="rose" />
          <CashFlowMetric label="Ay sonu" value={formatCurrency(cashFlow.projectedCash)} tone={cashFlow.projectedCash >= 0 ? 'emerald' : 'rose'} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>Gelire göre çıkış</span>
            <span>%{Math.round(outflowRate)}</span>
          </div>
          <Progress value={outflowRate} className="h-1.5" />
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground min-[430px]:grid-cols-2">
          <span>Kart: {formatCurrency(cashFlow.cardOutflow)}</span>
          <span>Kredi: {formatCurrency(cashFlow.loanOutflow)}</span>
          <span>Fatura/ödeme: {formatCurrency(cashFlow.paymentOutflow)}</span>
          <span>Kişisel borç: {formatCurrency(cashFlow.debtOutflow)}</span>
        </div>

        <div className="rounded-xl bg-muted/55 px-3 py-2 text-sm">
          <p className="text-muted-foreground">
            Mevcut nakit {formatCurrency(cashFlow.cashAssets)} · {cashFlow.recurringPayments} aylık ödeme takipte
          </p>
          <p className={`mt-1 font-bold tabular-nums ${projectionTone}`}>
            Bu ay tahmini net akış: {cashFlow.netFlow >= 0 ? '+' : ''}
            {formatCurrency(cashFlow.netFlow)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function CashFlowMetric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'

  return (
    <div className="min-w-0 rounded-xl bg-muted/55 px-3 py-2">
      <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[clamp(0.82rem,3.8vw,1rem)] font-extrabold leading-tight tabular-nums [overflow-wrap:anywhere] ${toneClass}`}>
        {value}
      </p>
    </div>
  )
}

function MetricTile({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'emerald' | 'rose' | 'amber' | 'indigo' | 'stone' }) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:ring-indigo-900',
    stone: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-800',
  }[tone]

  return (
    <Card size="sm" className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
      <CardContent className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 break-words text-[clamp(1rem,4.8vw,1.25rem)] font-extrabold leading-tight tabular-nums text-foreground">{value}</p>
        </div>
        <div className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${toneClass}`}>{icon}</div>
      </CardContent>
    </Card>
  )
}

function CreditLimitSection({ groups, totalUsageRate }: { groups: CreditLimitGroup[]; totalUsageRate: number }) {
  if (groups.length === 0) return null

  return (
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Kart limitleri</CardTitle>
          <Badge variant="secondary">%{Math.round(totalUsageRate)} kullanım</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-1">
        {groups.slice(0, 3).map((group) => (
          <div key={group.key} className="rounded-xl bg-muted/55 p-3">
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
    <Card className="border-0 shadow-sm ring-1 ring-stone-200/80 dark:ring-stone-800">
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${toneClass}`}>{icon}</div>
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

function ModernUpcomingRow({ item, onDismiss }: { item: UpcomingItem; onDismiss: (item: UpcomingItem) => Promise<void> }) {
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => void onDismiss(item)}
        className="absolute inset-y-0 right-0 grid w-16 place-items-center bg-rose-600 text-white"
        aria-label="Yaklaşan ödemeyi listeden gizle"
      >
        <Trash2 size={18} />
      </button>
      <article
        onPointerDown={(event) => setDragStart(event.clientX)}
        onPointerUp={(event) => {
          if (dragStart === null) return
          const delta = event.clientX - dragStart
          if (delta < -45) setIsOpen(true)
          if (delta > 30) setIsOpen(false)
          setDragStart(null)
        }}
        className={`relative flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-md transition-all duration-300 hover:border-indigo-300 hover:shadow-lg dark:border-stone-800 dark:bg-stone-900 dark:hover:border-indigo-700 ${
          isOpen ? '-translate-x-16' : 'translate-x-0'
        }`}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{item.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
            <CalendarDays size={14} className="text-stone-400 dark:text-stone-500" />
            {item.date}
          </p>
        </div>
        <div className="shrink-0 rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-indigo-100 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-indigo-900/30">
          {item.value}
        </div>
      </article>
    </div>
  )
}

function HistorySection({ rows }: { rows: TransactionHistory[] }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-bold text-stone-950 dark:text-stone-50">Son 3 ay işlem geçmişi</h2>
      {rows.length === 0 ? (
        <EmptyState title="İşlem geçmişi yok" description="Ödemeler, transferler ve borç kapatma işlemleri burada görünecek." />
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 20).map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-950 dark:text-stone-50">{row.title}</p>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{formatHistoryDate(row.occurred_at)}</p>
                </div>
                {row.amount !== null ? (
                  <span className="shrink-0 rounded-lg bg-stone-100 px-3 py-1.5 text-sm font-semibold text-stone-900 dark:bg-stone-800 dark:text-stone-100">
                    {formatCurrency(row.amount)}
                  </span>
                ) : null}
              </div>
              {row.note ? <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">{row.note}</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
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
