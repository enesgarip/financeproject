import { buildCashFlowForecast } from './cashFlowForecast'
import {
  buildFinancialPosition,
  getCurrentSalary,
  type FinanceSummaryInput,
} from './financeSummary'
import { diffTL, roundTL, sumTL } from './money'

export type LoanAffordabilityDecision = 'suitable' | 'caution' | 'not_recommended'

export type LoanAffordabilityAssumptions = {
  monthlyInterestRatePct: number
  termMonths: number
  requestedPrincipal?: number
  targetLoadRatio?: number
  cautionLoadRatio?: number
  minCashBufferMonths?: number
  horizonMonths?: number
  from?: Date
}

export type LoanAffordabilityRecommendation = {
  principal: number
  monthlyPayment: number
  termMonths: number
  totalPayment: number
  totalInterest: number
  loadRatio: number
  stressLowestBalance: number | null
  firstNegativeMonth: string | null
  label: string
  rationale: string
}

export type LoanAffordabilityResult = {
  stableMonthlyIncome: number
  cashAssets: number
  cashBufferMonths: number
  averageMonthlyOutflow: number
  peakNearTermOutflow: number
  assessedMonthlyLoad: number
  availableMonthlySurplus: number
  currentLoadRatio: number
  safeMonthlyPayment: number
  maxPrincipal: number
  maxTotalPayment: number
  maxTotalInterest: number
  requestedPrincipal: number
  requestedMonthlyPayment: number
  requestedTotalPayment: number
  requestedTotalInterest: number
  requestedLoadRatio: number
  requestedStressLowestBalance: number | null
  requestedFirstNegativeMonth: string | null
  recommendation: LoanAffordabilityRecommendation | null
  decision: LoanAffordabilityDecision
  summary: string
  reasons: string[]
}

type RecommendationCandidate = LoanAffordabilityRecommendation & {
  score: number
}

const RECOMMENDATION_TERMS = [6, 12, 18, 24, 36, 48, 60]

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return roundTL(sumTL(values) / values.length)
}

export function amortizedLoanPayment(principal: number, monthlyInterestRatePct: number, termMonths: number) {
  const normalizedPrincipal = Math.max(0, roundTL(principal))
  const months = Math.max(1, Math.round(termMonths))
  const rate = Math.max(0, monthlyInterestRatePct) / 100

  if (normalizedPrincipal <= 0) return 0
  if (rate === 0) return roundTL(normalizedPrincipal / months)

  const factor = (1 + rate) ** months
  return roundTL((normalizedPrincipal * rate * factor) / (factor - 1))
}

export function loanPrincipalFromPayment(monthlyPayment: number, monthlyInterestRatePct: number, termMonths: number) {
  const payment = Math.max(0, roundTL(monthlyPayment))
  const months = Math.max(1, Math.round(termMonths))
  const rate = Math.max(0, monthlyInterestRatePct) / 100

  if (payment <= 0) return 0
  if (rate === 0) return roundTL(payment * months)

  const factor = (1 + rate) ** months
  return roundTL(payment * ((factor - 1) / (rate * factor)))
}

function stressLowestBalance(
  months: Array<{ monthLabel: string; endingBalance: number }>,
  monthlyPayment: number,
  termMonths: number,
) {
  let lowestBalance: number | null = null
  let firstNegative: string | null = null

  months.forEach((month, index) => {
    // Assumption: the new loan's first installment starts next month.
    const paidInstallments = Math.max(0, Math.min(index, termMonths))
    const stressedBalance = diffTL(month.endingBalance, monthlyPayment * paidInstallments)
    if (lowestBalance === null || stressedBalance < lowestBalance) {
      lowestBalance = stressedBalance
    }
    if (!firstNegative && stressedBalance < 0) {
      firstNegative = month.monthLabel
    }
  })

  return {
    lowestBalance,
    firstNegativeMonth: firstNegative,
  }
}

function buildRecommendation({
  months,
  safeMonthlyPayment,
  monthlyInterestRatePct,
  stableMonthlyIncome,
  assessedMonthlyLoad,
  cautionLoadRatio,
  preferredTermMonths,
}: {
  months: Array<{ monthLabel: string; endingBalance: number }>
  safeMonthlyPayment: number
  monthlyInterestRatePct: number
  stableMonthlyIncome: number
  assessedMonthlyLoad: number
  cautionLoadRatio: number
  preferredTermMonths: number
}): LoanAffordabilityRecommendation | null {
  if (safeMonthlyPayment <= 0 || stableMonthlyIncome <= 0) return null

  const comfortablePayment = roundTL(safeMonthlyPayment * 0.85)
  if (comfortablePayment <= 0) return null

  const candidateTerms = Array.from(
    new Set([...RECOMMENDATION_TERMS, Math.max(1, Math.round(preferredTermMonths))]),
  ).sort((left, right) => left - right)

  const rawCandidates = candidateTerms.map((termMonths) => {
    const principal = loanPrincipalFromPayment(comfortablePayment, monthlyInterestRatePct, termMonths)
    const monthlyPayment = amortizedLoanPayment(principal, monthlyInterestRatePct, termMonths)
    const totalPayment = roundTL(monthlyPayment * termMonths)
    const totalInterest = Math.max(0, diffTL(totalPayment, principal))
    const loadRatio = stableMonthlyIncome > 0
      ? (assessedMonthlyLoad + monthlyPayment) / stableMonthlyIncome
      : 1
    const stress = stressLowestBalance(months, monthlyPayment, termMonths)

    return {
      principal,
      monthlyPayment,
      termMonths,
      totalPayment,
      totalInterest,
      loadRatio: clampRatio(loadRatio),
      stressLowestBalance: stress.lowestBalance,
      firstNegativeMonth: stress.firstNegativeMonth,
      label: 'Dengeli öneri',
      rationale: 'Güvenli taksit alanının tamamı yerine yaklaşık %85’i kullanılır; vade ve faiz maliyeti birlikte dengelenir.',
    }
  })

  const viable = rawCandidates.filter(
    (candidate) =>
      candidate.principal > 0 &&
      candidate.monthlyPayment <= safeMonthlyPayment &&
      candidate.loadRatio < cautionLoadRatio &&
      !candidate.firstNegativeMonth,
  )
  if (viable.length === 0) return null

  const largestPrincipal = Math.max(...viable.map((candidate) => candidate.principal))
  const scored: RecommendationCandidate[] = viable.map((candidate) => {
    const principalScore = largestPrincipal > 0 ? candidate.principal / largestPrincipal : 0
    const interestRatio = candidate.principal > 0 ? candidate.totalInterest / candidate.principal : 1
    const termPenalty = candidate.termMonths / Math.max(...candidateTerms)
    const loadPenalty = cautionLoadRatio > 0 ? candidate.loadRatio / cautionLoadRatio : 1
    const score = principalScore * 100 - interestRatio * 40 - termPenalty * 18 - loadPenalty * 10
    return { ...candidate, score }
  })

  const best = scored.reduce((currentBest, candidate) => (
    candidate.score > currentBest.score ? candidate : currentBest
  ))

  return {
    principal: best.principal,
    monthlyPayment: best.monthlyPayment,
    termMonths: best.termMonths,
    totalPayment: best.totalPayment,
    totalInterest: best.totalInterest,
    loadRatio: best.loadRatio,
    stressLowestBalance: best.stressLowestBalance,
    firstNegativeMonth: best.firstNegativeMonth,
    label: best.label,
    rationale: best.rationale,
  }
}

export function buildLoanAffordability(
  data: FinanceSummaryInput,
  assumptions: LoanAffordabilityAssumptions,
): LoanAffordabilityResult {
  const termMonths = Math.max(1, Math.round(assumptions.termMonths))
  const monthlyInterestRatePct = Math.max(0, assumptions.monthlyInterestRatePct)
  const targetLoadRatio = assumptions.targetLoadRatio ?? 0.6
  const cautionLoadRatio = assumptions.cautionLoadRatio ?? 0.75
  const minCashBufferMonths = assumptions.minCashBufferMonths ?? 1
  const horizonMonths = Math.max(3, assumptions.horizonMonths ?? 12)

  const position = buildFinancialPosition(data)
  const stableMonthlyIncome = roundTL(getCurrentSalary(data.salaryHistory)?.amount ?? 0)
  const forecast = buildCashFlowForecast(data, { from: assumptions.from, horizonMonths })
  const outflows = forecast.months.map((month) => month.outflow)
  const averageMonthlyOutflow = average(outflows)
  const peakNearTermOutflow = Math.max(0, ...outflows.slice(0, Math.min(3, outflows.length)))
  const assessedMonthlyLoad = Math.max(averageMonthlyOutflow, peakNearTermOutflow)
  const availableMonthlySurplus = diffTL(stableMonthlyIncome, assessedMonthlyLoad)
  const cashAssets = position.totalCashAssets
  const cashBufferMonths = assessedMonthlyLoad > 0 ? roundTL(cashAssets / assessedMonthlyLoad) : cashAssets > 0 ? 12 : 0
  const currentLoadRatio = stableMonthlyIncome > 0 ? assessedMonthlyLoad / stableMonthlyIncome : assessedMonthlyLoad > 0 ? 1 : 0

  const safeByLoadRatio = stableMonthlyIncome > 0
    ? diffTL(stableMonthlyIncome * targetLoadRatio, assessedMonthlyLoad)
    : 0
  const safeBySurplus = Math.max(0, availableMonthlySurplus * 0.75)
  const bufferFactor =
    cashBufferMonths < minCashBufferMonths / 2
      ? 0.35
      : cashBufferMonths < minCashBufferMonths
        ? 0.6
        : 1
  const safeMonthlyPayment = roundTL(Math.max(0, Math.min(safeByLoadRatio, safeBySurplus) * bufferFactor))
  const maxPrincipal = loanPrincipalFromPayment(safeMonthlyPayment, monthlyInterestRatePct, termMonths)
  const maxTotalPayment = roundTL(safeMonthlyPayment * termMonths)
  const maxTotalInterest = Math.max(0, diffTL(maxTotalPayment, maxPrincipal))

  const requestedPrincipal = Math.max(0, roundTL(assumptions.requestedPrincipal ?? maxPrincipal))
  const requestedMonthlyPayment = amortizedLoanPayment(requestedPrincipal, monthlyInterestRatePct, termMonths)
  const requestedTotalPayment = roundTL(requestedMonthlyPayment * termMonths)
  const requestedTotalInterest = Math.max(0, diffTL(requestedTotalPayment, requestedPrincipal))
  const requestedLoadRatio = stableMonthlyIncome > 0
    ? (assessedMonthlyLoad + requestedMonthlyPayment) / stableMonthlyIncome
    : requestedMonthlyPayment > 0 ? 1 : currentLoadRatio
  const stress = stressLowestBalance(forecast.months, requestedMonthlyPayment, termMonths)
  const recommendation = buildRecommendation({
    months: forecast.months,
    safeMonthlyPayment,
    monthlyInterestRatePct,
    stableMonthlyIncome,
    assessedMonthlyLoad,
    cautionLoadRatio,
    preferredTermMonths: termMonths,
  })

  const reasons: string[] = []
  if (stableMonthlyIncome <= 0) reasons.push('Düzenli maaş geliri bulunmadığı için kredi taşıma kapasitesi hesaplanamıyor.')
  if (currentLoadRatio >= targetLoadRatio) reasons.push('Mevcut aylık yük güvenli oranı zaten dolduruyor.')
  if (cashBufferMonths < minCashBufferMonths) reasons.push('Nakit tamponu bir aylık yükün altında görünüyor.')
  if (stress.firstNegativeMonth) reasons.push(`${stress.firstNegativeMonth} ayında nakit projeksiyonu negatife düşebilir.`)
  if (requestedMonthlyPayment > safeMonthlyPayment && safeMonthlyPayment > 0) {
    reasons.push('Seçilen tutarın taksiti güvenli taksit alanının üzerinde.')
  }
  if (requestedLoadRatio >= cautionLoadRatio) reasons.push('Kredi sonrası gelir-yük oranı yüksek risk bölgesine giriyor.')

  let decision: LoanAffordabilityDecision
  if (
    safeMonthlyPayment <= 0 ||
    requestedLoadRatio >= cautionLoadRatio ||
    Boolean(stress.firstNegativeMonth) ||
    stableMonthlyIncome <= 0
  ) {
    decision = 'not_recommended'
  } else if (requestedMonthlyPayment <= safeMonthlyPayment && cashBufferMonths >= minCashBufferMonths) {
    decision = 'suitable'
  } else {
    decision = 'caution'
  }

  const summary =
    decision === 'suitable'
      ? 'Bu senaryo mevcut veriye göre taşınabilir görünüyor.'
      : decision === 'caution'
        ? 'Bu senaryo taşınabilir olabilir ama tampon ve aylık yük yakından izlenmeli.'
        : 'Bu senaryo mevcut veriye göre zorlayıcı görünüyor.'

  if (reasons.length === 0) {
    reasons.push('Aylık yük, nakit tamponu ve gelecek dönem projeksiyonu güvenli aralıkta.')
  }

  return {
    stableMonthlyIncome,
    cashAssets,
    cashBufferMonths,
    averageMonthlyOutflow,
    peakNearTermOutflow,
    assessedMonthlyLoad,
    availableMonthlySurplus,
    currentLoadRatio: clampRatio(currentLoadRatio),
    safeMonthlyPayment,
    maxPrincipal,
    maxTotalPayment,
    maxTotalInterest,
    requestedPrincipal,
    requestedMonthlyPayment,
    requestedTotalPayment,
    requestedTotalInterest,
    requestedLoadRatio: clampRatio(requestedLoadRatio),
    requestedStressLowestBalance: stress.lowestBalance,
    requestedFirstNegativeMonth: stress.firstNegativeMonth,
    recommendation,
    decision,
    summary,
    reasons: reasons.slice(0, 5),
  }
}
