/**
 * Gerçekleşen aylık nakit çıkışı — projeksiyon değil, işlem geçmişi.
 * `transaction_history` kontratına (docs/TRANSACTION_HISTORY.md) dayanır:
 *  - amount her zaman pozitif büyüklük; yön type/title/note'tan türetilir.
 *  - "geri alındı" satırları nakit iadesi yapmaz; orijinal satırı netleştirmek
 *    için aynı source_id'nin son tutarı düşülür (paidPaymentIdsInMonth deseni).
 *  - Kart talimatlı planlı ödemeler (paymentUsesCreditCard) nakit değildir;
 *    banka yerine kart borcuna biner — ayrı raporlanır.
 * Aylık rapor "Nakit çıkışı"nı bu modülden besler; dashboard'ın kalan-yük
 * projeksiyonu (financeSummary.remainingOutflow) ile bilinçli olarak ayrıdır.
 */
import type { Payment, TransactionHistory } from '../types/database'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { paymentUsesCreditCard } from './financeObligationRules'
import { normalizeSearchText } from './searchText'
import { roundTL, sumTL } from './money'

export type RealizedMonthlyOutflow = {
  /** Kart ekstre/borç ödemeleri (pay_card_statement, pay_card_debt) — nakit. */
  cardPayments: number
  /** Banka kaynaklı planlı ödemeler (fatura vb.) — nakit. */
  billPayments: number
  /** Kart talimatlı planlı ödemeler — nakit DEĞİL, kart borcuna biner. */
  cardFundedBills: number
  /** Kredi taksit ödemeleri — nakit. */
  loanPayments: number
  /** Kişisel borç ödemeleri — nakit (tahsilatlar hariç). */
  debtPayments: number
  /** cardPayments + billPayments + loanPayments + debtPayments. */
  totalCash: number
}

const CARD_PAYMENT_SOURCES = new Set(['card_statement_archives', 'cards', 'card_current_settlements'])

function isUndone(text: string): boolean {
  return text.includes('geri alındı') || text.includes('geri alindi')
}

export function buildRealizedMonthlyOutflow(
  history: TransactionHistory[],
  payments: Payment[],
  month: Date = new Date(),
): RealizedMonthlyOutflow {
  const monthStart = dateInputValue(startOfMonth(month))
  const monthEnd = dateInputValue(startOfMonth(addMonths(month, 1)))
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]))

  const cardPayments: number[] = []
  const billPayments: number[] = []
  const cardFundedBills: number[] = []
  const loanPayments: number[] = []
  const debtPayments: number[] = []

  // Geri alma satırı orijinali netlesin diye kronolojik işlenir; her kova için
  // source_id başına eklenen tutarlar tutulur, undo gelince sonuncusu düşülür.
  const buckets: Array<{ list: number[]; bySource: Map<string, number[]> }> = []
  const bucketFor = (list: number[]) => {
    let bucket = buckets.find((b) => b.list === list)
    if (!bucket) {
      bucket = { list, bySource: new Map() }
      buckets.push(bucket)
    }
    return bucket
  }
  const push = (list: number[], row: TransactionHistory) => {
    if (row.amount == null || row.amount <= 0) return
    list.push(row.amount)
    if (row.source_id) {
      const bucket = bucketFor(list)
      const stack = bucket.bySource.get(row.source_id) ?? []
      stack.push(row.amount)
      bucket.bySource.set(row.source_id, stack)
    }
  }
  const undo = (row: TransactionHistory) => {
    if (!row.source_id) return
    for (const bucket of buckets) {
      const stack = bucket.bySource.get(row.source_id)
      if (!stack || stack.length === 0) continue
      const amount = stack.pop()!
      const index = bucket.list.lastIndexOf(amount)
      if (index >= 0) bucket.list.splice(index, 1)
      return
    }
  }

  const sorted = [...history].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  for (const row of sorted) {
    const occurred = dateInputValue(new Date(row.occurred_at))
    if (occurred < monthStart || occurred >= monthEnd) continue

    const text = normalizeSearchText(`${row.title} ${row.note ?? ''}`)

    if (row.type === 'payment') {
      if (isUndone(text)) {
        undo(row)
        continue
      }
      if (row.source_table && CARD_PAYMENT_SOURCES.has(row.source_table)) {
        push(cardPayments, row)
      } else if (row.source_table === 'payments') {
        const payment = row.source_id ? paymentsById.get(row.source_id) : undefined
        // Ödeme kaydı silinmişse temkinli davranıp nakit sayarız.
        if (payment && paymentUsesCreditCard(payment)) push(cardFundedBills, row)
        else push(billPayments, row)
      } else {
        push(billPayments, row)
      }
      continue
    }

    if (row.type === 'loan') {
      if (isUndone(text)) undo(row)
      else push(loanPayments, row)
      continue
    }

    if (row.type === 'debt') {
      if (isUndone(text)) {
        undo(row)
        continue
      }
      // settle_personal_debt hem borç ödemeyi hem alacak tahsilatını kapsar;
      // yalnız "hesabından/ödendi" yönü nakit çıkışıdır (activityFeed kuralı).
      if (text.includes('hesabından') || text.includes('hesabindan') || text.includes('ödendi') || text.includes('odendi')) {
        push(debtPayments, row)
      }
    }
  }

  const cardTotal = sumTL(cardPayments)
  const billTotal = sumTL(billPayments)
  const loanTotal = sumTL(loanPayments)
  const debtTotal = sumTL(debtPayments)

  return {
    cardPayments: roundTL(cardTotal),
    billPayments: roundTL(billTotal),
    cardFundedBills: roundTL(sumTL(cardFundedBills)),
    loanPayments: roundTL(loanTotal),
    debtPayments: roundTL(debtTotal),
    totalCash: sumTL([cardTotal, billTotal, loanTotal, debtTotal]),
  }
}
