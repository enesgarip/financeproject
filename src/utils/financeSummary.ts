import type {
  Asset,
  Card,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
} from '../types/database'
import { endOfMonth, isDateInMonth, monthlyOccurrenceDate, startOfMonth } from './date'
import { diffTL, exceedsTL, roundTL, sumTL, toKurus, toTL } from './money'
import { savingsGoalProgressRate } from './savingsGoal'

export type FinanceSummaryInput = {
  assets: Asset[]
  cards: Card[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salaryHistory: SalaryHistory[]
  cardInstallments: CardInstallment[]
  cardStatements?: CardStatementArchive[]
  savingsGoals?: SavingsGoal[]
  savingsGoalComponents?: SavingsGoalComponent[]
}

export type CreditLimitGroup = {
  key: string
  label: string
  limit: number
  debt: number
  statementDebt: number
  currentPeriod: number
  provision: number
  available: number
  usageRate: number
  isShared: boolean
  cards: Card[]
}

export type FinancialPositionSummary = {
  totalAssets: number
  totalCashAssets: number
  totalDebts: number
  netWorth: number
  netWorthIfReceivablesCollected: number
  totalCreditCardDebt: number
  totalCardStatementDebt: number
  totalCardCurrentPeriod: number
  totalCardProvision: number
  totalCardFutureInstallmentDebt: number
  totalLoanDebt: number
  totalPersonalDebts: number
  totalPaymentLiabilities: number
  totalReceivables: number
}

export type CashFlowSummary = {
  monthLabel: string
  cashAssets: number
  income: number
  receivableIncome: number
  outflow: number
  netFlow: number
  projectedCash: number
  recurringPayments: number
  cardStatementDebt: number
  cardOutflow: number
  loanOutflow: number
  paymentOutflow: number
  debtOutflow: number
}

export type GoalProgressSummary = {
  activeCount: number
  averageProgress: number
  nextGoalName: string | null
  nextGoalRemaining: number
  nextGoalMonthlyNeed: number
}

export type FinancialHealthSummary = {
  score: number
  label: string
  description: string
  tone: 'emerald' | 'amber' | 'rose'
  factors: string[]
}

export function sum<T>(rows: T[], selector: (row: T) => number) {
  return sumTL(rows.map(selector))
}

export function cardProvisionAmount(card: Pick<Card, 'provision_amount'>) {
  return card.provision_amount ?? 0
}

export function cardSplitTotal(statementDebt: number, currentPeriod: number, provisionAmount: number) {
  return sumTL([statementDebt, currentPeriod, provisionAmount])
}

export function scheduledCardInstallmentTotalsByCard(installments: Pick<CardInstallment, 'card_id' | 'amount' | 'status'>[]) {
  const totals = new Map<string, number>()

  for (const installment of installments) {
    if (installment.status !== 'scheduled') continue
    totals.set(installment.card_id, sumTL([totals.get(installment.card_id), installment.amount]))
  }

  return totals
}

export type CardDebtBreakdown = {
  splitTotal: number
  scheduledTotal: number
  unclassifiedAmount: number
  unexplainedAmount: number
  nextDebtAmount: number
  hasSplitOverflow: boolean
  hasScheduledDebtGap: boolean
  hasUnexplainedDebt: boolean
}

export function cardDebtBreakdown(
  card: Pick<Card, 'debt_amount' | 'statement_debt_amount' | 'current_period_spending' | 'provision_amount'>,
  scheduledTotal = 0,
): CardDebtBreakdown {
  const splitTotal = cardSplitTotal(card.statement_debt_amount, card.current_period_spending, cardProvisionAmount(card))
  const normalizedScheduledTotal = roundTL(scheduledTotal)
  const unclassifiedAmount = diffTL(card.debt_amount, splitTotal)
  const unexplainedAmount = diffTL(unclassifiedAmount, Math.min(unclassifiedAmount, normalizedScheduledTotal))

  const hasSplitOverflow = exceedsTL(splitTotal, card.debt_amount)
  const hasDebtBeyondSplit = exceedsTL(card.debt_amount, splitTotal)

  return {
    splitTotal,
    scheduledTotal: normalizedScheduledTotal,
    unclassifiedAmount,
    unexplainedAmount,
    nextDebtAmount: sumTL([card.debt_amount, normalizedScheduledTotal]),
    hasSplitOverflow,
    hasScheduledDebtGap: exceedsTL(normalizedScheduledTotal, 0) && !hasDebtBeyondSplit,
    hasUnexplainedDebt: hasDebtBeyondSplit && exceedsTL(unexplainedAmount, 0),
  }
}

export function cardPayableDebt(card: Pick<Card, 'statement_debt_amount' | 'current_period_spending'>) {
  return Math.max(0, sumTL([card.statement_debt_amount, card.current_period_spending]))
}

/**
 * Clamps a credit card's debt breakdown so `statement + provision + current`
 * never exceeds `debt` (roadmap "güven" Faz 1). Priority: statement is the most
 * protected, then provision, then current absorbs the remainder. This is the
 * TS twin of the DB BEFORE trigger `clamp_card_breakdown()` — the single source
 * of truth for the invariant, shared with the DataHealth split check.
 */
export function clampCardBreakdown(debt: number, statement: number, current: number, provision: number) {
  const totalK = Math.max(0, toKurus(debt))
  const clampedStatementK = Math.min(Math.max(0, toKurus(statement)), totalK)
  const clampedProvisionK = Math.min(Math.max(0, toKurus(provision)), Math.max(0, totalK - clampedStatementK))
  const clampedCurrentK = Math.min(Math.max(0, toKurus(current)), Math.max(0, totalK - clampedStatementK - clampedProvisionK))
  return { statement: toTL(clampedStatementK), provision: toTL(clampedProvisionK), current: toTL(clampedCurrentK) }
}

export function cardMonthlyPaymentAmount(card: Pick<Card, 'statement_debt_amount'>) {
  return card.statement_debt_amount
}

/**
 * Projects a loan's summary from its installment plan (roadmap "güven" Faz 2).
 * remaining = sum of unpaid (status != 'ödendi') amounts, remaining_installments
 * = unpaid count, status = 'closed' when none unpaid else 'active'. This is the
 * TS twin of the DB trigger `sync_loan_summary()` — the single source of truth,
 * shared with the DataHealth `loanTotals` check.
 */
export function projectLoanSummary(installments: Pick<LoanInstallment, 'amount' | 'status'>[]): {
  remainingAmount: number
  remainingInstallments: number
  status: Loan['status']
} {
  const pending = installments.filter((item) => item.status !== 'ödendi')
  const remainingInstallments = pending.length
  return {
    remainingAmount: sumTL(pending.map((item) => item.amount)),
    remainingInstallments,
    status: remainingInstallments === 0 ? 'closed' : 'active',
  }
}

/**
 * Canonical per-installment amount for a card expense (roadmap "güven" Madde 1).
 * Single çekim (count <= 1) → full amount; aksi halde round(amount / count, 2).
 * TS twin of the DB BEFORE trigger `derive_card_expense_installment_amount()` —
 * the single source of truth, shared with the DataHealth `cardExpenseAmount` check.
 */
export function expectedInstallmentAmount(amount: number, installmentCount: number) {
  if (!installmentCount || installmentCount <= 1) return roundTL(amount)
  return roundTL(amount / installmentCount)
}

export function creditLimitGroupKey(card: Card) {
  return card.limit_group_name?.trim() || card.id
}

export function totalCreditLimit(cards: Card[]) {
  const limitsByGroup = new Map<string, number>()

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
    const groupKey = creditLimitGroupKey(card)
    limitsByGroup.set(groupKey, Math.max(limitsByGroup.get(groupKey) ?? 0, card.credit_limit))
  }

  return sumTL(limitsByGroup.values())
}

export function buildCreditLimitGroups(cards: Card[]): CreditLimitGroup[] {
  const groups = new Map<string, Card[]>()

  for (const card of cards.filter((item) => item.card_type === 'kredi_karti')) {
    const key = creditLimitGroupKey(card)
    groups.set(key, [...(groups.get(key) ?? []), card])
  }

  return Array.from(groups, ([key, groupCards]) => {
    const limit = Math.max(...groupCards.map((card) => card.credit_limit), 0)
    const debt = sum(groupCards, (card) => card.debt_amount)
    const statementDebt = sum(groupCards, (card) => card.statement_debt_amount)
    const currentPeriod = sum(groupCards, (card) => card.current_period_spending)
    const provision = sum(groupCards, cardProvisionAmount)
    const usageRate = limit > 0 ? Math.min(100, (debt / limit) * 100) : 0
    const groupName = groupCards.find((card) => card.limit_group_name?.trim())?.limit_group_name?.trim()

    return {
      key,
      label: groupName || groupCards[0]?.card_name || 'Kart grubu',
      limit,
      debt,
      statementDebt,
      currentPeriod,
      provision,
      available: Math.max(0, diffTL(limit, debt)),
      usageRate,
      isShared: Boolean(groupName) && groupCards.length > 1,
      cards: groupCards,
    }
  }).sort((a, b) => b.debt - a.debt)
}

export function getSalaryTrend(rows: SalaryHistory[]) {
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  const current = ordered.at(-1) ?? null
  const previous = ordered.at(-2) ?? null

  if (!current || !previous || previous.amount <= 0) return { current, previous, difference: 0, percentage: 0 }

  const difference = diffTL(current.amount, previous.amount)
  return {
    current,
    previous,
    difference,
    percentage: (difference / previous.amount) * 100,
  }
}

export function getCurrentSalary(rows: SalaryHistory[]) {
  const today = new Date().toLocaleDateString('sv-SE')
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  return getSalaryForDate(ordered, today) ?? ordered.at(-1) ?? null
}

export function getSalaryForDate(rows: SalaryHistory[], date: Date | string) {
  const cutoff = typeof date === 'string' ? date.slice(0, 10) : date.toLocaleDateString('sv-SE')
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  return ordered.filter((row) => row.effective_date <= cutoff).at(-1) ?? null
}

export function paymentOccurrenceInMonth(payment: Payment, month = new Date()) {
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

export function paymentUsesCreditCard(payment: Pick<Payment, 'payment_method' | 'auto_source_card_id'>) {
  return payment.payment_method === 'bank_auto' && Boolean(payment.auto_source_card_id)
}

export function paymentCashOutflowAmount(payment: Pick<Payment, 'amount' | 'payment_method' | 'auto_source_card_id'>) {
  return paymentUsesCreditCard(payment) ? 0 : payment.amount
}

export function buildFinancialPosition(data: FinanceSummaryInput): FinancialPositionSummary {
  const bankCards = data.cards.filter((card) => card.card_type === 'banka_karti')
  const creditCards = data.cards.filter((card) => card.card_type === 'kredi_karti')
  const totalCashAssets = sumTL([
    sum(data.assets.filter((asset) => asset.category === 'Nakit'), (asset) => asset.estimated_value_try),
    sum(bankCards, (card) => card.current_balance),
  ])
  const totalAssets = sumTL([
    sum(data.assets, (asset) => asset.estimated_value_try),
    sum(bankCards, (card) => card.current_balance),
  ])
  const totalCreditCardDebt = sum(creditCards, (card) => card.debt_amount)
  const totalCardStatementDebt = sum(creditCards, (card) => card.statement_debt_amount)
  const totalCardCurrentPeriod = sum(creditCards, (card) => card.current_period_spending)
  const totalCardProvision = sum(creditCards, cardProvisionAmount)
  const totalCardSplitDebt = cardSplitTotal(totalCardStatementDebt, totalCardCurrentPeriod, totalCardProvision)
  const totalCardFutureInstallmentDebt = Math.max(0, diffTL(totalCreditCardDebt, totalCardSplitDebt))
  const totalLoanDebt = sum(
    data.loans.filter((loan) => loan.status === 'active'),
    (loan) => loan.remaining_amount,
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
  const totalPaymentLiabilities = sum(
    data.payments.filter((payment) => payment.status === 'bekliyor'),
    (payment) => payment.amount,
  )
  const totalDebts = sumTL([totalCreditCardDebt, totalLoanDebt, totalPersonalDebts, totalPaymentLiabilities])
  const netWorth = diffTL(totalAssets, totalDebts)

  return {
    totalAssets,
    totalCashAssets,
    totalDebts,
    netWorth,
    netWorthIfReceivablesCollected: sumTL([netWorth, totalReceivables]),
    totalCreditCardDebt,
    totalCardStatementDebt,
    totalCardCurrentPeriod,
    totalCardProvision,
    totalCardFutureInstallmentDebt,
    totalLoanDebt,
    totalPersonalDebts,
    totalPaymentLiabilities,
    totalReceivables,
  }
}

export function buildMonthlyCashFlow(data: FinanceSummaryInput, month = new Date()): CashFlowSummary {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(monthStart)
  const currentSalary = getCurrentSalary(data.salaryHistory)
  const cashAssets = buildFinancialPosition(data).totalCashAssets
  const openDebts = data.debts.filter((debt) => debt.status === 'açık')
  const receivableIncome = sum(
    openDebts.filter((debt) => debt.direction === 'borç_verdim' && isDateInMonth(debt.due_date, monthStart)),
    (debt) => debt.estimated_value_try,
  )
  const paymentOutflow = sum(
    data.payments.filter((payment) => paymentOccurrenceInMonth(payment, monthStart)),
    paymentCashOutflowAmount,
  )
  const recurringPayments = data.payments.filter((payment) => payment.recurrence === 'monthly' && payment.status === 'bekliyor').length
  const cardStatementDebt = sum(
    data.cards.filter((card) => card.card_type === 'kredi_karti'),
    cardMonthlyPaymentAmount,
  )
  const cardOutflow = sum(
    data.cards.filter((card) => {
      const dueDate = monthlyOccurrenceDate(card.due_day, monthStart)
      return card.card_type === 'kredi_karti' && cardMonthlyPaymentAmount(card) > 0 && dueDate !== null && dueDate >= monthStart && dueDate <= monthEnd
    }),
    cardMonthlyPaymentAmount,
  )
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
  const scheduledLoanOutflow = sum(
    data.loanInstallments.filter((installment) => installment.status === 'bekliyor' && isDateInMonth(installment.due_date, monthStart)),
    (installment) => installment.amount,
  )
  const legacyLoanOutflow = sum(
    data.loans.filter((loan) => {
      const dueDate = monthlyOccurrenceDate(loan.installment_day, monthStart)
      return !plannedLoanIds.has(loan.id) && loan.status === 'active' && loan.remaining_installments > 0 && dueDate !== null && dueDate >= monthStart && dueDate <= monthEnd
    }),
    (loan) => loan.monthly_payment,
  )
  const loanOutflow = sumTL([scheduledLoanOutflow, legacyLoanOutflow])
  const debtOutflow = sum(
    openDebts.filter((debt) => debt.direction === 'borç_aldım' && isDateInMonth(debt.due_date, monthStart)),
    (debt) => debt.estimated_value_try,
  )
  const income = sumTL([currentSalary?.amount, receivableIncome])
  const outflow = sumTL([paymentOutflow, cardOutflow, loanOutflow, debtOutflow])
  const netFlow = diffTL(income, outflow)

  return {
    monthLabel,
    cashAssets,
    income,
    receivableIncome,
    outflow,
    netFlow,
    projectedCash: sumTL([cashAssets, netFlow]),
    recurringPayments,
    cardStatementDebt,
    cardOutflow,
    loanOutflow,
    paymentOutflow,
    debtOutflow,
  }
}

export function buildGoalProgressSummary(goals: SavingsGoal[] = [], components: SavingsGoalComponent[] = []): GoalProgressSummary {
  const activeGoals = goals.filter((goal) => goal.status === 'active')
  const rates = activeGoals.map((goal) => savingsGoalProgressRate(goal, components))
  const averageProgress = rates.length > 0 ? rates.reduce((total, rate) => total + rate, 0) / rates.length : 0
  const today = startOfMonth()
  const goalsWithNeed = activeGoals
    .filter((goal) => goal.target_date && goal.target_amount > goal.current_amount)
    .map((goal) => {
      const targetDate = new Date(`${goal.target_date}T00:00:00`)
      const monthDelta = (targetDate.getFullYear() - today.getFullYear()) * 12 + targetDate.getMonth() - today.getMonth()
      const remainingMonths = Math.max(1, monthDelta + 1)
      const remaining = Math.max(0, diffTL(goal.target_amount, goal.current_amount))
      return {
        goal,
        remaining,
        monthlyNeed: roundTL(remaining / remainingMonths),
        targetTime: targetDate.getTime(),
      }
    })
    .sort((a, b) => a.targetTime - b.targetTime)
  const nextGoal = goalsWithNeed[0]

  return {
    activeCount: activeGoals.length,
    averageProgress,
    nextGoalName: nextGoal?.goal.name ?? null,
    nextGoalRemaining: nextGoal?.remaining ?? 0,
    nextGoalMonthlyNeed: nextGoal?.monthlyNeed ?? 0,
  }
}

export function buildFinancialHealth({
  position,
  cashFlow,
  creditUsageRate,
  urgentUpcomingCount,
  averageGoalProgress,
}: {
  position: FinancialPositionSummary
  cashFlow: CashFlowSummary
  creditUsageRate: number
  urgentUpcomingCount: number
  averageGoalProgress: number
}): FinancialHealthSummary {
  let score = 100
  const factors: string[] = []
  const debtToAssetRatio = position.totalAssets > 0 ? position.totalDebts / position.totalAssets : position.totalDebts > 0 ? 1.5 : 0
  const outflowRatio = cashFlow.income > 0 ? cashFlow.outflow / cashFlow.income : cashFlow.outflow > 0 ? 1.2 : 0
  const cashBufferMonths = cashFlow.outflow > 0 ? position.totalCashAssets / cashFlow.outflow : position.totalCashAssets > 0 ? 6 : 0

  if (debtToAssetRatio >= 1) {
    score -= 30
    factors.push('Borçların varlıkları aşıyor; net değer baskı altında.')
  } else if (debtToAssetRatio >= 0.6) {
    score -= 20
    factors.push('Borç / varlık oranı yüksek; yeni yük almadan önce kapatma planı iyi olur.')
  } else if (debtToAssetRatio >= 0.3) {
    score -= 10
    factors.push('Borç seviyesi yönetilebilir ama düzenli izleme gerektiriyor.')
  } else {
    factors.push('Borç / varlık oranı dengeli görünüyor.')
  }

  if (outflowRatio >= 1) {
    score -= 25
    factors.push('Bu ayki ödeme yükü geliri aşıyor.')
  } else if (outflowRatio >= 0.75) {
    score -= 15
    factors.push('Aylık ödeme yükü gelire göre yüksek.')
  } else if (outflowRatio >= 0.5) {
    score -= 8
    factors.push('Aylık çıkışlar izlenebilir seviyede.')
  } else {
    factors.push('Aylık nakit çıkışı gelire göre rahat.')
  }

  if (creditUsageRate >= 80) {
    score -= 20
    factors.push('Kart limit kullanımı riskli bölgede.')
  } else if (creditUsageRate >= 55) {
    score -= 10
    factors.push('Kart limit kullanımı orta-yüksek seviyede.')
  }

  if (cashBufferMonths < 1 && cashFlow.outflow > 0) {
    score -= 15
    factors.push('Nakit tamponu bir aylık ödeme yükünün altında.')
  } else if (cashBufferMonths < 3 && cashFlow.outflow > 0) {
    score -= 8
    factors.push('Nakit tamponu var ama acil durum fonu güçlendirilebilir.')
  } else if (cashBufferMonths >= 3) {
    score += 5
    factors.push('Nakit tamponu birkaç aylık yükü karşılayabiliyor.')
  }

  if (urgentUpcomingCount >= 3) {
    score -= 8
    factors.push('Yakın vadeli ödeme yoğunluğu yüksek.')
  } else if (urgentUpcomingCount > 0) {
    score -= 3
    factors.push('Yakın vadeli ödeme var; takvim kontrolü yeterli.')
  }

  if (averageGoalProgress >= 60) {
    score += 5
    factors.push('Aktif hedeflerde ilerleme güçlü.')
  } else if (averageGoalProgress > 0 && averageGoalProgress < 25) {
    score -= 5
    factors.push('Hedef ilerlemesi düşük; aylık birikim planı gerekebilir.')
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)))
  const tone = normalizedScore >= 80 ? 'emerald' : normalizedScore >= 60 ? 'amber' : 'rose'
  const label = normalizedScore >= 80 ? 'Dengeli' : normalizedScore >= 60 ? 'İzlenmeli' : 'Riskli'
  const description =
    tone === 'emerald'
      ? 'Genel tablo dengeli; odağı hedef ve erken borç kapatmaya ayırabilirsin.'
      : tone === 'amber'
        ? 'Genel tablo yönetilebilir, fakat bu ay birkaç kalem yakından izlenmeli.'
        : 'Borç, nakit akışı veya limit kullanımı hızlı aksiyon gerektiriyor.'

  return {
    score: normalizedScore,
    label,
    description,
    tone,
    factors: factors.slice(0, 5),
  }
}
