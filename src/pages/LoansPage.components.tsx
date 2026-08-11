import type { Loan, LoanInstallment } from '../types/database'
import { formatDate } from '../utils/date'
import { sumTL } from '../utils/money'
import { HeroNumber, SERIT_TEXT, useSeritAmount } from '../components/serit'
import { nextPendingInstallment } from './LoansPage.helpers'

/**
 * Krediler ekranının kahraman rakamı — Şerit (`4b`): **kalan anapara**, altında
 * aylık toplam taksit ve sıradaki vade. Kart yok; blok sayfa zemininde durur.
 */
export function LoanOverview({ loans, installments }: { loans: Loan[]; installments: LoanInstallment[] }) {
  const format = useSeritAmount()
  const activeLoans = loans.filter((loan) => loan.status === 'active')

  if (activeLoans.length === 0) {
    // Hiç kredi yoksa CrudPage'in kendi boş durumu devreye girer. Burada yalnızca
    // "kredileri olan ama hepsi kapanmış" durumu için olumlu tek satır.
    if (loans.length === 0) return null
    return (
      <p className="text-[13px] text-ink-muted">
        Tüm kredilerin kapandı — aylık taksit yükün{' '}
        <span className="serit-num font-semibold" style={{ color: SERIT_TEXT.brand }}>
          0 ₺
        </span>
        . Geçmiş planlar aşağıda.
      </p>
    )
  }

  const totalRemaining = sumTL(activeLoans.map((loan) => loan.remaining_amount))
  const totalMonthly = sumTL(activeLoans.map((loan) => loan.monthly_payment))
  const monthly = format(totalMonthly)
  const nextPayment = activeLoans
    .map((loan) => ({ loan, item: nextPendingInstallment(loan, installments) }))
    .filter((entry): entry is { loan: Loan; item: LoanInstallment } => Boolean(entry.item))
    .sort((a, b) => a.item.due_date.localeCompare(b.item.due_date))[0]

  return (
    <section>
      <HeroNumber
        label="Kalan kredi anaparası"
        value={totalRemaining}
        description={
          <>
            {activeLoans.length} aktif kredi · aylık{' '}
            <span className="serit-num font-semibold" style={{ color: SERIT_TEXT.brand }}>
              {monthly.amount} {monthly.unit}
            </span>
          </>
        }
      />

      {nextPayment ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-muted">
          Sıradaki taksit <span className="font-semibold text-ink">{nextPayment.loan.loan_name}</span> ·{' '}
          {formatDate(nextPayment.item.due_date)} ·{' '}
          <span className="serit-num font-semibold text-ink">{format(nextPayment.item.amount).amount} ₺</span>
        </p>
      ) : null}
    </section>
  )
}
