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
  buildCreditLimitGroups,
  cardDebtBreakdown,
  expectedInstallmentAmount,
  projectLoanSummary,
  scheduledCardInstallmentTotalsByCard,
} from './financeSummary'

export type HealthSummary = {
  errors: number
  warnings: number
  /** Bulgu toplamı (errors + warnings). Yapılan kontrol sayısı DEĞİL. */
  total: number
  /**
   * Kaç kontrol koşturuldu. Her kart 3, ödeme planı olan her kredi 2, taksitli
   * her harcama 1, her limit grubu 1 kontrol demek.
   *
   * Neden gerekli: "2 bulgu" tek başına kötü mü iyi mi belli değil — 2/4 ile
   * 2/36 aynı cümleyi kurmaz. Şerit'in `3d` ekranı "0 hata · 2 uyarı ·
   * 34 kontrol temiz" diyor; bu alan o cümlenin paydası.
   */
  checksRun: number
  /** Sorunsuz geçen kontrol sayısı — `checksRun - total`, hiç negatif olmaz. */
  cleanChecks: number
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
  // Kontrol sayacı bulgu sayacından AYRI ilerler: bir kontrol koştuğunda artar,
  // sonucu temiz olsa da olmasa da.
  let checksRun = 0

  const scheduledByCard = scheduledCardInstallmentTotalsByCard(data.cardInstallments)

  for (const card of data.cards.filter((c) => c.card_type === 'kredi_karti')) {
    const breakdown = cardDebtBreakdown(card, scheduledByCard.get(card.id) ?? 0)
    checksRun += 3
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
    // Ödeme planı olmayan kredide kontrol KOŞMUYOR; sayaca da girmemeli,
    // yoksa "temiz geçti" diye sayılır.
    if (!insts || insts.length === 0) continue
    const projected = projectLoanSummary(insts)
    checksRun += 2
    if (moneyDiffers(loan.remaining_amount, projected.remainingAmount)) errors++
    if (loan.remaining_installments !== projected.remainingInstallments) warnings++
  }

  const installmentsByExpense = new Map<string, CardInstallment[]>()
  for (const inst of data.cardInstallments) {
    if (!inst.card_expense_id) continue
    installmentsByExpense.set(inst.card_expense_id, [...(installmentsByExpense.get(inst.card_expense_id) ?? []), inst])
  }

  for (const expense of data.cardExpenses) {
    // Tek çekimde taksit tutarı kontrolü anlamsız — kontrol koşmuyor.
    if (expense.installment_count <= 1) continue
    const expected = expectedInstallmentAmount(expense.amount, expense.installment_count)
    checksRun += 1
    if (moneyDiffers(expense.installment_amount, expected)) warnings++
  }

  for (const group of buildCreditLimitGroups(data.cards)) {
    // Limitsiz grupta aşım kontrolü yapılamaz.
    if (group.limit <= 0) continue
    checksRun += 1
    if (exceedsTL(group.debt, group.limit)) warnings++
  }

  const total = errors + warnings
  return {
    errors,
    warnings,
    total,
    checksRun,
    // Teorik olarak total > checksRun olamaz ama sayaçlar ayrı ilerlediği için
    // kelepçeliyoruz: negatif "temiz kontrol" ekrana asla çıkmasın.
    cleanChecks: Math.max(0, checksRun - total),
  }
}
