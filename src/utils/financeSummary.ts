/**
 * Finansal özetin matematik çekirdeği. Saf hesap (Supabase görmez), yoğun test
 * edilir. İki ana çıktı üretir, hepsi tek `FinanceSummaryInput`'tan:
 *
 *  1. buildFinancialPosition  → BİLANÇO anlık görüntüsü (varlık, borç, net değer).
 *     "Şu an ne kadar zenginim?" — stok büyüklükleri.
 *  2. buildMonthlyCashFlow    → bir ayın NAKİT AKIŞI (gelir, çıkış, net, projeksiyon).
 *     "Bu ay para nasıl akıyor?" — akış büyüklükleri. Yükümlülükleri
 *     `obligations.ts`'ten alır, nakit etkisini (cashImpact) toplar.
 *
 * Ayrıca DB trigger'larının SAF TS İKİZLERİ burada yaşar: `clampCardBreakdown`,
 * `projectLoanSummary`, `expectedInstallmentAmount`. Bunlar invariant'ın tek
 * kaynağıdır; aynı kod hem DataHealth kontrolünde hem testte kullanılır
 * (bkz. CLAUDE.md "Ledger & trigger invariant'ları").
 *
 * Para kuralı: tüm yuvarlama/karşılaştırma money.ts üzerinden (roundTL, diffTL,
 * sumTL, exceedsTL...). Çıplak Math.round veya +0.01 toleransı YAZMA.
 */
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
import { endOfMonth, startOfMonth } from './date'
import { diffTL, exceedsTL, roundTL, sumTL, toKurus, toTL } from './money'
import { buildFinanceObligationsForMonth, getFirstBusinessDay, type FinanceObligation, type FinanceObligationsInput } from './obligations'

export {
  buildCreditCardIdCheck,
  cardMonthlyPaymentAmount,
  cardPayableDebt,
  paymentCashOutflowAmount,
  paymentOccurrenceInMonth,
  paymentUsesCreditCard,
  type CreditCardIdCheck,
} from './financeObligationRules'

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
  /**
   * Bu modüldeki hiçbir hesap birikim hedeflerini OKUMAZ; alanlar yalnız
   * çağıranların aynı nesneyi başka util'lere de geçirebilmesi için opsiyonel
   * duruyor (bkz. analysisFinanceSummaryInput). Hedef matematiği
   * `savingsGoal.ts` + `savingsSuggestion.ts`'te.
   */
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
  salaryIncome: number
  receivableIncome: number
  outflow: number
  /** Cari ayda bugünden ay sonuna kalan çıkış; geçmiş aylar için outflow ile aynı. */
  remainingOutflow: number
  /** Henüz girmemiş gelir (maaş yatmadıysa + kalan tahsilat). */
  expectedIncome: number
  netFlow: number
  projectedCash: number
  recurringPayments: number
  cardStatementDebt: number
  cardOutflow: number
  loanOutflow: number
  paymentOutflow: number
  debtOutflow: number
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
  scheduledDebtOverlapAmount: number
  hasSplitOverflow: boolean
  hasScheduledDebtGap: boolean
  hasPartialScheduledDebtOverlap: boolean
  hasUnexplainedDebt: boolean
}

/**
 * Bir kredi kartının toplam borcunu (`debt_amount`) parçalarına ayırıp
 * tutarsızlık var mı diye bakar. Mantık:
 *  - splitTotal       = ekstre + dönem içi + provizyon (kartın "açıklanmış" borcu).
 *  - unclassified     = toplam borç − splitTotal (henüz parçalara yazılmamış kısım).
 *  - scheduledTotal   = ileri tarihli taksitler; unclassified'ın bu kadarı normaldir.
 *  - unexplained      = taksitlerle de açıklanamayan, yani "kayıp" borç (alarm).
 *
 * Dört bayrak DataHealth uyarılarını besler:
 *  - hasSplitOverflow    → parçalar toplamı borcu aşıyor (clamp gerekiyor).
 *  - hasScheduledDebtGap → taksitlerin tamamı borcun dışında kalmış.
 *  - hasPartialScheduledDebtOverlap → taksitlerin yalnız bir kısmı borçta açıklanabiliyor.
 *  - hasUnexplainedDebt  → ne parça ne taksitle açıklanan fazla borç.
 */
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
  const hasPartialScheduledDebtOverlap =
    !hasSplitOverflow &&
    hasDebtBeyondSplit &&
    exceedsTL(normalizedScheduledTotal, unclassifiedAmount)
  const scheduledDebtOverlapAmount = hasPartialScheduledDebtOverlap
    ? diffTL(normalizedScheduledTotal, unclassifiedAmount)
    : 0

  return {
    splitTotal,
    scheduledTotal: normalizedScheduledTotal,
    unclassifiedAmount,
    unexplainedAmount,
    scheduledDebtOverlapAmount,
    hasSplitOverflow,
    hasScheduledDebtGap: exceedsTL(normalizedScheduledTotal, 0) && !hasSplitOverflow && !hasDebtBeyondSplit,
    hasPartialScheduledDebtOverlap,
    hasUnexplainedDebt: hasDebtBeyondSplit && exceedsTL(unexplainedAmount, 0),
  }
}

/**
 * Clamps a credit card's debt breakdown so `statement + provision + current`
 * never exceeds `debt` (roadmap "güven" Faz 1). Öncelik sırası: önce statement
 * korunur, sonra provision, en son current — yani kalan pay bittiğinde AŞAĞI
 * kırpılan da current olur. (Eski yorum "current absorbs the remainder" diyordu;
 * hiçbir kova şişirilmez, üçü de yalnız kırpılır. Toplam `debt`'ten KÜÇÜK
 * kalabilir; bu artık `cardDebtBreakdown.unexplainedAmount` ile raporlanır.)
 * This is the TS twin of the DB BEFORE trigger `clamp_card_breakdown()` — the
 * single source of truth for the invariant, shared with the DataHealth split check.
 */
export function clampCardBreakdown(debt: number, statement: number, current: number, provision: number) {
  const totalK = Math.max(0, toKurus(debt))
  const clampedStatementK = Math.min(Math.max(0, toKurus(statement)), totalK)
  const clampedProvisionK = Math.min(Math.max(0, toKurus(provision)), Math.max(0, totalK - clampedStatementK))
  const clampedCurrentK = Math.min(Math.max(0, toKurus(current)), Math.max(0, totalK - clampedStatementK - clampedProvisionK))
  return { statement: toTL(clampedStatementK), provision: toTL(clampedProvisionK), current: toTL(clampedCurrentK) }
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
    // Shared-limit banks expose one limit across cards — take max, not sum
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
  const today = new Date().toLocaleDateString('sv-SE')
  const ordered = [...rows]
    .filter((row) => row.effective_date <= today)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  const current = ordered.at(-1) ?? null
  const previous = ordered.at(-2) ?? null

  if (!current || !previous || previous.amount <= 0) return { current, previous, difference: 0, percentage: 0 }

  const difference = diffTL(current.amount, previous.amount)
  return {
    current,
    previous,
    difference,
    percentage: previous.amount > 0 ? (difference / previous.amount) * 100 : 0,
  }
}

export function getCurrentSalary(rows: SalaryHistory[]) {
  const today = new Date().toLocaleDateString('sv-SE')
  return getSalaryForDate(rows, today)
}

export function getSalaryForDate(rows: SalaryHistory[], date: Date | string) {
  const cutoff = typeof date === 'string' ? date.slice(0, 10) : date.toLocaleDateString('sv-SE')
  const ordered = [...rows].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
  return ordered.filter((row) => row.effective_date <= cutoff).at(-1) ?? null
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
  // Borcun ekstre+dönem+provizyon ile açıklanmayan kısmı = ileri tarihli taksitler.
  // KART BAŞINA hesaplanır: agregat fark, bir karttaki split taşmasının (negatif
  // kalan) başka kartın gerçek gelecek-taksit borcunu sessizce netlemesine izin
  // verirdi (denetim 2026-08-12 K13).
  const totalCardFutureInstallmentDebt = sum(creditCards, (card) =>
    Math.max(
      0,
      diffTL(
        card.debt_amount,
        cardSplitTotal(card.statement_debt_amount, card.current_period_spending, cardProvisionAmount(card)),
      ),
    ),
  )
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
    // Only one-off pending bills are a balance-sheet liability. Recurring monthly
    // payments are ongoing expenses (captured in the cash-flow / monthly load),
    // not debt principal, so they must not reduce net worth.
    data.payments.filter((payment) => payment.status === 'bekliyor' && payment.recurrence !== 'monthly'),
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

function obligationsInput(data: FinanceSummaryInput): FinanceObligationsInput {
  return {
    cards: data.cards,
    payments: data.payments,
    loans: data.loans,
    loanInstallments: data.loanInstallments,
    debts: data.debts,
    cardInstallments: data.cardInstallments,
    cardStatements: data.cardStatements ?? [],
    salaryHistory: data.salaryHistory,
  }
}

function obligationCashImpact(item: FinanceObligation) {
  return item.cashImpactAmount ?? item.amount
}

function obligationSum(
  items: FinanceObligation[],
  predicate: (item: FinanceObligation) => boolean,
  selector: (item: FinanceObligation) => number = obligationCashImpact,
) {
  return sumTL(items.filter(predicate).map(selector))
}

export function buildMonthlyCashFlow(
  data: FinanceSummaryInput,
  month = new Date(),
  options: { from?: Date; today?: Date } = {},
): CashFlowSummary {
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(monthStart)
  const salaryIncome = roundTL(getSalaryForDate(data.salaryHistory, monthEnd)?.amount ?? 0)
  const cashAssets = buildFinancialPosition(data).totalCashAssets
  const from = options.from ?? monthStart
  const obligations = buildFinanceObligationsForMonth(obligationsInput(data), monthStart, { from })

  // Ay-görünümü (income/outflow) ay başı perspektifiyle kalır; projectedCash ise
  // bugün perspektifiyle hesaplanmalı. Aksi halde ödenmiş ekstre sonrası dönem içi
  // harcama, geçmiş vade gününe (ör. 14 Tem) yazılıp bugünkü nakitten bir kez daha
  // düşülüyor ve ay sonu nakit sahte açık veriyor (bkz. obligations.ts dönem içi notu).
  const today = options.today ?? new Date()
  const isCurrentMonth = monthStart.getTime() === startOfMonth(today).getTime()
  const remainingObligations = isCurrentMonth && !options.from
    ? buildFinanceObligationsForMonth(obligationsInput(data), monthStart, { from: today })
    : obligations

  const receivableIncome = obligationSum(obligations, (item) => item.kind === 'personal_receivable')
  const paymentOutflow = obligationSum(
    obligations,
    (item) => item.kind === 'payment',
  )
  const recurringPayments = data.payments.filter((payment) => payment.recurrence === 'monthly' && payment.status === 'bekliyor').length
  const cardOutflow = obligationSum(
    obligations,
    (item) => item.kind === 'card_statement' || item.kind === 'card_debt' || item.kind === 'card_installment',
  )
  const cardStatementDebt = cardOutflow
  const loanOutflow = obligationSum(
    obligations,
    (item) => item.kind === 'loan_installment' || item.kind === 'legacy_loan_installment',
  )
  const debtOutflow = obligationSum(obligations, (item) => item.kind === 'personal_debt')
  const income = sumTL([salaryIncome, receivableIncome])
  const outflow = sumTL([paymentOutflow, cardOutflow, loanOutflow, debtOutflow])
  const netFlow = diffTL(income, outflow)

  const isOutflowKind = (item: FinanceObligation) =>
    item.kind === 'payment' ||
    item.kind === 'card_statement' ||
    item.kind === 'card_debt' ||
    item.kind === 'card_installment' ||
    item.kind === 'loan_installment' ||
    item.kind === 'legacy_loan_installment' ||
    item.kind === 'personal_debt'
  const remainingOutflow = obligationSum(remainingObligations, isOutflowKind)
  const remainingReceivableIncome = obligationSum(remainingObligations, (item) => item.kind === 'personal_receivable')

  const salaryLikelyReceived = isCurrentMonth && today > getFirstBusinessDay(monthStart)
  const projectedIncome = sumTL([salaryLikelyReceived ? 0 : salaryIncome, remainingReceivableIncome])

  return {
    monthLabel,
    cashAssets,
    income,
    salaryIncome,
    receivableIncome,
    outflow,
    remainingOutflow,
    expectedIncome: projectedIncome,
    netFlow,
    projectedCash: sumTL([cashAssets, diffTL(projectedIncome, remainingOutflow)]),
    recurringPayments,
    cardStatementDebt,
    cardOutflow,
    loanOutflow,
    paymentOutflow,
    debtOutflow,
  }
}

/*
 * `buildGoalProgressSummary` burada durup hiçbir yerden çağrılmıyordu (tek
 * çağıranı DashboardPage'de hesaplanıp render edilmeden atılıyordu) ve
 * ürettiği her alanın canlı bir karşılığı zaten vardı: ilerleme oranı
 * `savingsGoalProgressRate`, "aylık gerekli" ise `savingsSuggestion.ts`.
 *
 * Silinme gerekçesi yalnız ölü kod değil: aynı hesabın iki ayrı
 * implementasyonu olması Faz D2'deki hatanın SEBEBİYDİ — biri karma hedef
 * guard'ını taşıyordu, diğeri taşımıyordu ve bileşen sayısını TL sanıyordu.
 * Düzeltilmiş kopyayı tüketicisiz tutmak aynı tuzağı canlı bırakırdı.
 * Hedef özeti bir panele gerekirse `buildSavingsSuggestion` üzerine kurulmalı.
 */

