import { addMonths, dateInputValue, startOfMonth } from './date'
import { projectLoanSummary, type FinanceSummaryInput } from './financeSummary'
import { roundTL, sumTL } from './money'

export type ScenarioMutation =
  | { type: 'remove_loan'; loanId: string }
  | { type: 'remove_payment'; paymentId: string }
  | { type: 'payoff_loan_today'; loanId: string }
  | { type: 'cash_shock'; amount: number }

/**
 * Returns a modified copy of `data` with the requested mutations applied.
 * Multiple mutations accumulate — removing a loan strips both the loan row
 * and all its installments from the projection.
 *
 * 'payoff_loan_today' satır bazında remove_loan ile AYNI şeyi yapar (kredi +
 * taksitleri projeksiyondan düşer); farkı, bugünkü nakit bedelinin
 * `scenarioStartingCashDelta` üzerinden başlangıç bakiyesine yansımasıdır.
 * 'cash_shock' satırlara hiç dokunmaz — etkisi yalnız nakit deltasıdır.
 */
export function applyScenario(data: FinanceSummaryInput, mutations: ScenarioMutation[]): FinanceSummaryInput {
  if (mutations.length === 0) return data

  const removedLoans = new Set(
    mutations.flatMap((m) => (m.type === 'remove_loan' || m.type === 'payoff_loan_today' ? [m.loanId] : [])),
  )
  const removedPayments = new Set(
    mutations.flatMap((m) => (m.type === 'remove_payment' ? [m.paymentId] : [])),
  )

  return {
    ...data,
    loans: removedLoans.size > 0 ? data.loans.filter((l) => !removedLoans.has(l.id)) : data.loans,
    loanInstallments:
      removedLoans.size > 0
        ? data.loanInstallments.filter((i) => !removedLoans.has(i.loan_id))
        : data.loanInstallments,
    payments: removedPayments.size > 0 ? data.payments.filter((p) => !removedPayments.has(p.id)) : data.payments,
  }
}

/**
 * Kredinin bugün kapatma bedeli. Planlı kredide ödenmemiş taksit toplamı
 * (projectLoanSummary); plansız (legacy) kredide forecast'ın türettiği çıkışla
 * AYNI taban — monthly_payment × remaining_installments (obligations.ts legacy
 * dalı). Farklı bir taban (örn. loan.remaining_amount) senaryo bakiyesini
 * içsel olarak tutarsız yapardı.
 */
export function loanPayoffAmount(data: FinanceSummaryInput, loanId: string): number {
  const loan = data.loans.find((l) => l.id === loanId)
  if (!loan) return 0
  const installments = data.loanInstallments.filter((i) => i.loan_id === loanId)
  if (installments.length > 0) return projectLoanSummary(installments).remainingAmount
  return roundTL(loan.monthly_payment * Math.max(0, loan.remaining_installments))
}

/**
 * Senaryonun 0. gün nakit etkisi (negatif = bugün cepten çıkan para).
 * `buildCashFlowForecast`'ın `startingBalanceDelta` opsiyonuna verilir.
 */
export function scenarioStartingCashDelta(data: FinanceSummaryInput, mutations: ScenarioMutation[]): number {
  const parts: number[] = []
  for (const mutation of mutations) {
    if (mutation.type === 'payoff_loan_today') parts.push(loanPayoffAmount(data, mutation.loanId))
    else if (mutation.type === 'cash_shock') parts.push(mutation.amount)
  }
  const total = sumTL(parts)
  return total === 0 ? 0 : -total
}

/**
 * Payoff senaryosunda senaryo bakiyesinin baz bakiyeyi yakaladığı ayın anahtarı
 * (forecast monthKey formatında). Payoff bedeli kalan taksit toplamı olduğundan
 * bu, matematiksel olarak SON bekleyen taksitin ayıdır — iki forecast koşusunu
 * kıyaslamak gerekmez (6 aylık ufuk çoğu kredide o ayı hiç göremezdi).
 * Planlı kredide bekleyen taksitlerin en geç vadesi; legacy kredide forecast'ın
 * legacy türetimiyle hizalı olarak from ayı + remaining_installments − 1.
 */
export function payoffBreakEvenMonthKey(
  data: FinanceSummaryInput,
  loanId: string,
  from: Date = new Date(),
): string | null {
  const loan = data.loans.find((l) => l.id === loanId)
  if (!loan) return null

  const pending = data.loanInstallments.filter((i) => i.loan_id === loanId && i.status !== 'ödendi')
  if (pending.length > 0) {
    const last = pending.reduce((a, b) => (b.due_date > a.due_date ? b : a))
    return dateInputValue(startOfMonth(new Date(`${last.due_date.slice(0, 10)}T00:00:00`)))
  }

  const hasPlanRows = data.loanInstallments.some((i) => i.loan_id === loanId)
  if (hasPlanRows || loan.remaining_installments <= 0) return null
  return dateInputValue(startOfMonth(addMonths(startOfMonth(from), loan.remaining_installments - 1)))
}
