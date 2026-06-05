import type { FinanceSummaryInput } from './financeSummary'

export type ScenarioMutation =
  | { type: 'remove_loan'; loanId: string }
  | { type: 'remove_payment'; paymentId: string }

/**
 * Returns a modified copy of `data` with the requested mutations applied.
 * Multiple mutations accumulate — removing a loan strips both the loan row
 * and all its installments from the projection.
 */
export function applyScenario(data: FinanceSummaryInput, mutations: ScenarioMutation[]): FinanceSummaryInput {
  if (mutations.length === 0) return data

  const removedLoans = new Set(
    mutations
      .filter((m): m is Extract<ScenarioMutation, { type: 'remove_loan' }> => m.type === 'remove_loan')
      .map((m) => m.loanId),
  )
  const removedPayments = new Set(
    mutations
      .filter((m): m is Extract<ScenarioMutation, { type: 'remove_payment' }> => m.type === 'remove_payment')
      .map((m) => m.paymentId),
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
