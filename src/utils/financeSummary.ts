import type {
  Asset,
  Card,
  CardInstallment,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
} from '../types/database'
import { dateInputValue, endOfMonth, isDateInMonth, monthlyOccurrenceDate, startOfMonth } from './date'
import { roundTL, toKurus } from './money'
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
  savingsGoals?: SavingsGoal[]
  savingsGoalComponents?: SavingsGoalComponent[]
}

export type CreditLimitGroup = {
  key: string
  label: string
  limit: number
  debt: number
  available: number
  usageRate: number
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

export type MonthlyLoadSummary = {
  monthLabel: string
  total: number
  payments: number
  cardStatements: number
  cardInstallments: number
  loanInstallments: number
  legacyLoanInstallments: number
  personalDebts: number
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
  return rows.reduce((total, row) => total + selector(row), 0)
}

export function roundMoney(value: number) {
  return roundTL(value)
}

export function moneyDiffers(left: number, right: number) {
  // 1 kuruşluk tolerans korunur ama float çıkarma yerine tam sayı kuruş üzerinden.
  return Math.abs(toKurus(left) - toKurus(right)) > 1
}

export function cardProvisionAmount(card: Pick<Card, 'provision_amount'>) {
  return card.provision_amount ?? 0
}

export function cardSplitTotal(statementDebt: number, currentPeriod: number, provisionAmount: number) {
  return roundMoney(statementDebt + currentPeriod + provisionAmount)
}

export function cardPayableDebt(card: Pick<Card, 'statement_debt_amount' | 'current_period_spending'>) {
  return roundMoney(Math.max(0, card.statement_debt_amount + card.current_period_spending))
}

export function cardMonthlyPaymentAmount(card: Pick<Card, 'statement_debt_amount'>) {
  return card.statement_debt_amount
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

  return Array.from(limitsByGroup.values()).reduce((total, limit) => total + limit, 0)
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

export function getSalaryTrend(rows: SalaryHistory[]) {
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

export function getCurrentSalary(rows: SalaryHistory[]) {
  const today = new Date().toLocaleDateString('sv-SE')
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  return ordered.filter((row) => row.effective_date <= today).at(-1) ?? ordered.at(-1) ?? null
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
  const totalCashAssets = sum(
    data.assets.filter((asset) => asset.category === 'Nakit'),
    (asset) => asset.estimated_value_try,
  ) + sum(bankCards, (card) => card.current_balance)
  const totalAssets = sum(data.assets, (asset) => asset.estimated_value_try) + sum(bankCards, (card) => card.current_balance)
  const totalCreditCardDebt = sum(creditCards, (card) => card.debt_amount)
  const totalCardStatementDebt = sum(creditCards, (card) => card.statement_debt_amount)
  const totalCardCurrentPeriod = sum(creditCards, (card) => card.current_period_spending)
  const totalCardProvision = sum(creditCards, cardProvisionAmount)
  const totalCardSplitDebt = cardSplitTotal(totalCardStatementDebt, totalCardCurrentPeriod, totalCardProvision)
  const totalCardFutureInstallmentDebt = roundMoney(Math.max(0, totalCreditCardDebt - totalCardSplitDebt))
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
  const totalDebts = roundMoney(totalCreditCardDebt + totalLoanDebt + totalPersonalDebts + totalPaymentLiabilities)
  const netWorth = roundMoney(totalAssets - totalDebts)

  return {
    totalAssets,
    totalCashAssets,
    totalDebts,
    netWorth,
    netWorthIfReceivablesCollected: roundMoney(netWorth + totalReceivables),
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
  const loanOutflow = scheduledLoanOutflow + legacyLoanOutflow
  const debtOutflow = sum(
    openDebts.filter((debt) => debt.direction === 'borç_aldım' && isDateInMonth(debt.due_date, monthStart)),
    (debt) => debt.estimated_value_try,
  )
  const income = (currentSalary?.amount ?? 0) + receivableIncome
  const outflow = paymentOutflow + cardOutflow + loanOutflow + debtOutflow
  const netFlow = income - outflow

  return {
    monthLabel,
    cashAssets,
    income,
    receivableIncome,
    outflow,
    netFlow,
    projectedCash: cashAssets + netFlow,
    recurringPayments,
    cardStatementDebt,
    cardOutflow,
    loanOutflow,
    paymentOutflow,
    debtOutflow,
  }
}

export function buildMonthlyLoad(data: FinanceSummaryInput, month: Date): MonthlyLoadSummary {
  const monthStart = startOfMonth(month)
  const monthPrefix = dateInputValue(monthStart).slice(0, 7)
  const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(monthStart)
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))
  const inTargetMonth = (value: string | null | undefined) => Boolean(value && value.slice(0, 7) === monthPrefix)
  const payments = sum(
    data.payments.filter((payment) => paymentOccurrenceInMonth(payment, monthStart)),
    (payment) => payment.amount,
  )
  const cardStatements = sum(
    data.cards.filter((card) => {
      const dueDate = monthlyOccurrenceDate(card.due_day, monthStart)
      return card.card_type === 'kredi_karti' && cardMonthlyPaymentAmount(card) > 0 && dueDate !== null && isDateInMonth(dueDate, monthStart)
    }),
    cardMonthlyPaymentAmount,
  )
  const cardInstallments = sum(
    data.cardInstallments.filter((installment) => installment.status === 'scheduled' && inTargetMonth(installment.due_month)),
    (installment) => installment.amount,
  )
  const loanInstallments = sum(
    data.loanInstallments.filter((installment) => installment.status === 'bekliyor' && isDateInMonth(installment.due_date, monthStart)),
    (installment) => installment.amount,
  )
  const legacyLoanInstallments = sum(
    data.loans.filter((loan) => {
      const dueDate = monthlyOccurrenceDate(loan.installment_day, monthStart)
      return !plannedLoanIds.has(loan.id) && loan.status === 'active' && loan.remaining_installments > 0 && dueDate !== null
    }),
    (loan) => loan.monthly_payment,
  )
  const personalDebts = sum(
    data.debts.filter((debt) => debt.direction === 'borç_aldım' && debt.status === 'açık' && isDateInMonth(debt.due_date, monthStart)),
    (debt) => debt.estimated_value_try,
  )

  return {
    monthLabel,
    total: payments + cardStatements + cardInstallments + loanInstallments + legacyLoanInstallments + personalDebts,
    payments,
    cardStatements,
    cardInstallments,
    loanInstallments,
    legacyLoanInstallments,
    personalDebts,
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
      const remaining = Math.max(0, goal.target_amount - goal.current_amount)
      return {
        goal,
        remaining,
        monthlyNeed: remaining / remainingMonths,
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
