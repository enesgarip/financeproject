/**
 * Dashboard'daki veri-sağlığı rozeti için hafif sayım: kaç hata / kaç uyarı var?
 *
 * Tam DataHealth sayfası ayrıntılı kontrolleri yapar; bu dosya aynı invariant
 * ikizlerini (financeSummary.ts'ten cardDebtBreakdown / projectLoanSummary /
 * expectedInstallmentAmount) kullanarak sadece SAYIYI üretir. DRY: kural tek
 * kaynakta, burada yeniden uygulanmaz. errors = mutlaka düzeltilmeli,
 * warnings = göz atılmalı.
 */
import type {
  Card,
  CardExpense,
  CardInstallment,
  Loan,
  LoanInstallment,
} from '../types/database'
import { exceedsTL, moneyDiffers } from './money'
import {
  cardDebtBreakdown,
  expectedInstallmentAmount,
  projectLoanSummary,
  scheduledCardInstallmentTotalsByCard,
} from './financeSummary'

export type HealthSummary = {
  errors: number
  warnings: number
  total: number
}

type HealthCountInput = {
  cards: Card[]
  cardExpenses: CardExpense[]
  cardInstallments: CardInstallment[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
}

export function buildHealthCounts(data: HealthCountInput): HealthSummary {
  let errors = 0
  let warnings = 0

  const scheduledByCard = scheduledCardInstallmentTotalsByCard(data.cardInstallments)

  for (const card of data.cards.filter((c) => c.card_type === 'kredi_karti')) {
    const breakdown = cardDebtBreakdown(card, scheduledByCard.get(card.id) ?? 0)
    if (breakdown.hasSplitOverflow) errors++
    if (breakdown.hasScheduledDebtGap) errors++
    if (breakdown.hasUnexplainedDebt) warnings++
  }

  const installmentsByLoan = new Map<string, LoanInstallment[]>()
  for (const inst of data.loanInstallments) {
    installmentsByLoan.set(inst.loan_id, [...(installmentsByLoan.get(inst.loan_id) ?? []), inst])
  }

  for (const loan of data.loans) {
    const insts = installmentsByLoan.get(loan.id)
    if (!insts || insts.length === 0) continue
    const projected = projectLoanSummary(insts)
    if (moneyDiffers(loan.remaining_amount, projected.remainingAmount)) errors++
    if (loan.remaining_installments !== projected.remainingInstallments) warnings++
  }

  const installmentsByExpense = new Map<string, CardInstallment[]>()
  for (const inst of data.cardInstallments) {
    if (!inst.card_expense_id) continue
    installmentsByExpense.set(inst.card_expense_id, [...(installmentsByExpense.get(inst.card_expense_id) ?? []), inst])
  }

  for (const expense of data.cardExpenses) {
    if (expense.installment_count <= 1) continue
    const expected = expectedInstallmentAmount(expense.amount, expense.installment_count)
    if (moneyDiffers(expense.installment_amount, expected)) warnings++
  }

  for (const card of data.cards.filter((c) => c.card_type === 'kredi_karti')) {
    if (card.credit_limit > 0 && exceedsTL(card.debt_amount, card.credit_limit)) warnings++
  }

  return { errors, warnings, total: errors + warnings }
}
