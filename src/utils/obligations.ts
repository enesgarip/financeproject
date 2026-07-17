/**
 * "Bu ay (veya şu tarih aralığında) ne ödenecek / ne tahsil edilecek?"
 * sorusunun tek kaynağı. Saf okuma-tarafı projeksiyon: hiçbir şey yazmaz,
 * Supabase görmez; eldeki kart/kredi/ödeme/borç/maaş verisinden bir ayın
 * yükümlülük listesini (`FinanceObligation[]`) türetir.
 *
 * Neden tek tablo değil de projeksiyon: yükümlülükler farklı tablolardan
 * (ekstre, kredi taksiti, kişisel borç, talimatlı ödeme...) gelir ve sürekli
 * değişir. Tek bir "yapılacaklar" tablosu tutmak senkronizasyon borcu yaratırdı;
 * bunun yerine her okumada kaynak veriden yeniden hesaplıyoruz. Gerekçe:
 * docs/PLANNING_MODEL_REVIEW.md.
 *
 * İki para alanı ayrımı (önemli):
 *  - `amount`        → kalemin nominal tutarı (ekranda "X TL borç" diye gösterilir).
 *  - `cashImpactAmount` → bu ay bankadan gerçekten çıkacak nakit. Karta yazılan
 *    taksit/ödeme için 0'dır (çıkış değil, kart borcuna dönüşür). Nakit akışı
 *    toplamları (`summarizeFinanceObligations`) cashImpact'i kullanır, amount'u değil.
 *
 * Kart borcu modeli "Option A" (bilinen veri): kesilmiş ekstre bir kez kendi
 * son ödeme gününde, dönem içi harcama bir kez sonraki çevrimde sayılır — ay ay
 * tekrar etmez. Detay aşağıda card_debt projeksiyonunda.
 *
 * Ana giriş: `buildFinanceObligationsForMonth` (tek ay). Aralık için
 * `buildFinanceObligationsForRange` onu aylara bölüp çağırır.
 */
import type {
  Card,
  CardInstallment,
  CardStatementArchive,
  Debt,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
} from '../types/database'
import { getCardStatementPeriod, getNextCardPaymentDueDate } from './cardStatement'
import { addDays, addMonths, dateInputValue, endOfMonth, isDateInMonth, monthlyOccurrenceDate, startOfDay, startOfMonth } from './date'
import { cardMonthlyPaymentAmount, paymentCashOutflowAmount, paymentOccurrenceInMonth, paymentUsesCreditCard } from './financeObligationRules'
import { roundTL, sumTL } from './money'

export type FinanceObligationKind =
  | 'payment'
  | 'card_statement'
  | 'card_debt'
  | 'card_installment'
  | 'loan_installment'
  | 'legacy_loan_installment'
  | 'personal_debt'
  | 'personal_receivable'
  | 'salary'

export type FinanceObligationAction =
  | 'pay_payment'
  | 'pay_card_statement'
  | 'pay_card_debt'
  | 'pay_loan_installment'
  | 'settle_debt'
  | 'collect_debt'

export type FinanceObligationDirection = 'outflow' | 'inflow'
export type FinanceObligationSettlement = 'cash' | 'credit_card'

export type FinanceObligation = {
  id: string
  kind: FinanceObligationKind
  action: FinanceObligationAction | null
  sourceId: string
  relatedCardId?: string
  title: string
  subtitle: string
  date: string
  amount: number // nominal tutar (ekranda gösterilen borç/tahsilat)
  cashImpactAmount?: number // bu ay bankadan çıkacak gerçek nakit (karta yazılırsa 0); yoksa amount kabul edilir
  direction: FinanceObligationDirection
  settlement?: FinanceObligationSettlement
  isEstimate?: boolean // tutar tahmini/otomatik değerlenmiş mi (kesin değil)
}

export type FinanceObligationsInput = {
  cards: Card[]
  payments: Payment[]
  loans: Loan[]
  loanInstallments: LoanInstallment[]
  debts: Debt[]
  cardInstallments: CardInstallment[]
  cardStatements: CardStatementArchive[]
  salaryHistory?: SalaryHistory[]
}

export type FinanceObligationMonthSummary = {
  outflow: number
  inflow: number
  net: number
  payableCount: number
  itemCount: number
}

function obligationCashImpact(item: FinanceObligation) {
  return item.cashImpactAmount ?? item.amount
}

function monthDistance(from: Date, target: Date) {
  return (target.getFullYear() - from.getFullYear()) * 12 + target.getMonth() - from.getMonth()
}

export function getFirstBusinessDay(month: Date) {
  const first = startOfMonth(month)
  const day = first.getDay()
  if (day === 0) return addDays(first, 1)
  if (day === 6) return addDays(first, 2)
  return first
}

function monthsInRange(from: Date, to: Date) {
  const months: Date[] = []
  const cursor = startOfMonth(from)
  const end = startOfMonth(to)

  while (cursor <= end) {
    months.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return months
}

function dateIsInRange(value: string, from: Date, to: Date) {
  const date = startOfDay(new Date(`${value}T00:00:00`))
  return date >= startOfDay(from) && date <= startOfDay(to)
}

function cardLabel(card: Card | undefined) {
  return card ? `${card.bank_name} - ${card.card_name}` : 'Kart'
}

function currentPeriodPaymentDueDate(card: Card, nextDue: string, from: Date | undefined, hasPendingStatement: boolean) {
  if (hasPendingStatement) {
    return dateInputValue(addMonths(new Date(`${nextDue}T00:00:00`), 1))
  }

  return getCardStatementPeriod(card, from)?.dueDate ?? nextDue
}

// Listeye kalem ekleme tek kapısı: tutarı negatife düşürmez ve cashImpact'i
// normalize eder. allowZero=true sadece tutarı tahmini olan kalemler için
// (henüz tutarı belirsiz ama vadesi gelen ödeme listede görünmeli).
function addObligation(items: FinanceObligation[], item: FinanceObligation, options: { allowZero?: boolean } = {}) {
  if (!options.allowZero && item.amount <= 0) return
  const amount = roundTL(Math.max(0, item.amount))
  items.push({
    ...item,
    amount,
    cashImpactAmount: roundTL(Math.max(0, item.cashImpactAmount ?? amount)),
    settlement: item.settlement ?? 'cash',
  })
}

export function buildFinanceObligationsForMonth(
  data: FinanceObligationsInput,
  month: Date,
  options: { from?: Date } = {},
): FinanceObligation[] {
  const monthStart = startOfMonth(month)
  const fromMonth = startOfMonth(options.from ?? new Date())
  const items: FinanceObligation[] = []
  const cardsById = new Map(data.cards.map((card) => [card.id, card]))
  const openStatements = data.cardStatements.filter((statement) => statement.status === 'open')
  const cardsWithOpenStatements = new Set(openStatements.map((statement) => statement.card_id))

  for (const payment of data.payments) {
    const occurrence = paymentOccurrenceInMonth(payment, monthStart)
    if (!occurrence) continue
    const usesCreditCard = paymentUsesCreditCard(payment)
    const autoSourceCard = payment.auto_source_card_id ? cardsById.get(payment.auto_source_card_id) : undefined

    addObligation(
      items,
      {
        id: `payment-${payment.id}-${dateInputValue(occurrence)}`,
        kind: 'payment',
        action: 'pay_payment',
        sourceId: payment.id,
        relatedCardId: payment.auto_source_card_id ?? undefined,
        title: payment.title,
        subtitle: usesCreditCard
          ? `${payment.category} - ${cardLabel(autoSourceCard)} kart talimati`
          : payment.recurrence === 'monthly'
            ? `${payment.category} - aylik`
            : payment.category,
        date: dateInputValue(occurrence),
        amount: payment.amount,
        cashImpactAmount: paymentCashOutflowAmount(payment),
        direction: 'outflow',
        settlement: usesCreditCard ? 'credit_card' : 'cash',
        isEstimate: payment.amount_status === 'estimated',
      },
      { allowZero: payment.amount_status === 'estimated' },
    )
  }

  for (const statement of openStatements) {
    const dueDate = statement.due_date ?? statement.statement_date
    if (!isDateInMonth(dueDate, monthStart)) continue

    const card = cardsById.get(statement.card_id)
    addObligation(items, {
      id: `card-statement-${statement.id}`,
      kind: 'card_statement',
      action: 'pay_card_statement',
      sourceId: statement.id,
      relatedCardId: statement.card_id,
      title: `${card?.card_name ?? 'Kredi kartı'} ekstresi`,
      subtitle: cardLabel(card),
      date: dueDate,
      amount: statement.statement_debt_amount,
      direction: 'outflow',
    })
  }

  for (const card of data.cards.filter((row) => row.card_type === 'kredi_karti')) {
    const nextDue = getNextCardPaymentDueDate(card, options.from)

    if (!cardsWithOpenStatements.has(card.id) && nextDue && isDateInMonth(nextDue, monthStart)) {
      addObligation(items, {
        id: `card-debt-statement-${card.id}-${nextDue}`,
        kind: 'card_debt',
        action: 'pay_card_debt',
        sourceId: card.id,
        relatedCardId: card.id,
        title: `${card.card_name} ekstre borcu`,
        subtitle: card.bank_name,
        date: nextDue,
        amount: cardMonthlyPaymentAmount(card),
        direction: 'outflow',
      })
    }

    // Dönem içi harcama henüz ekstreye girmedi; gerçek nakit çıkışı, açık dönemin
    // kesileceği ekstrenin son ödeme gününde olur. Bekleyen ekstre varsa mevcut
    // vade o ekstreye aittir; açık dönem bir sonraki çevrimde ödenir. Bekleyen
    // ekstre yoksa tarihi kartın kesim/vade periyodundan türetiriz; böylece
    // son ekstre erken ödendikten sonra bugünkü dönem içi harcama eski vade gününe
    // (ör. 14 Temmuz) tekrar bindirilmez.
    // action: null — ekstre kesilmeden ödenecek bir kalem yok (sadece projeksiyon).
    if (nextDue && card.current_period_spending > 0) {
      const hasPendingStatement = cardsWithOpenStatements.has(card.id) || card.statement_debt_amount > 0
      const currentPeriodDueDate = currentPeriodPaymentDueDate(card, nextDue, options.from, hasPendingStatement)
      if (isDateInMonth(currentPeriodDueDate, monthStart)) {
        addObligation(items, {
          id: `card-debt-current-${card.id}-${currentPeriodDueDate}`,
          kind: 'card_debt',
          action: null,
          sourceId: card.id,
          relatedCardId: card.id,
          title: `${card.card_name} dönem içi borç`,
          subtitle: `${card.bank_name} - sonraki ekstre`,
          date: currentPeriodDueDate,
          amount: card.current_period_spending,
          direction: 'outflow',
        })
      }
    }
  }

  for (const installment of data.cardInstallments) {
    if (installment.status !== 'scheduled' || !isDateInMonth(installment.due_month, monthStart)) continue

    const card = cardsById.get(installment.card_id)
    addObligation(items, {
      id: `card-installment-${installment.id}`,
      kind: 'card_installment',
      action: null,
      sourceId: installment.id,
      relatedCardId: installment.card_id,
      title: installment.description,
      subtitle: `${cardLabel(card)} - ${installment.installment_no}/${installment.installment_count}. taksit`,
      date: installment.due_month,
      amount: installment.amount,
      cashImpactAmount: 0,
      direction: 'outflow',
      settlement: 'credit_card',
    })
  }

  // Kredilerin gerçek taksit planı (loan_installments) varsa onu kullanırız.
  // plannedLoanIds = planı olan krediler; bunları aşağıdaki "legacy" tahminden
  // hariç tutarız ki aynı taksit iki kez sayılmasın.
  const plannedLoanIds = new Set(data.loanInstallments.map((installment) => installment.loan_id))

  for (const installment of data.loanInstallments) {
    if (installment.status !== 'bekliyor' || !isDateInMonth(installment.due_date, monthStart)) continue

    const loan = data.loans.find((row) => row.id === installment.loan_id)
    addObligation(items, {
      id: `loan-installment-${installment.id}`,
      kind: 'loan_installment',
      action: 'pay_loan_installment',
      sourceId: installment.id,
      title: loan?.loan_name ?? 'Kredi taksiti',
      subtitle: `${loan?.bank_name ?? 'Kredi'} - ${installment.installment_no}. taksit`,
      date: installment.due_date,
      amount: installment.amount,
      direction: 'outflow',
    })
  }

  // Legacy/yedek dal: taksit planı OLUŞTURULMAMIŞ aktif krediler. Plan yoksa
  // kalan taksit sayısı + aylık ödeme + taksit gününden tahmini taksitler türetilir
  // (isEstimate). offset = bu ayın krediden kaç ay sonra olduğu; remaining_installments'ı
  // aşan veya start/end tarih penceresi dışına düşen aylar atlanır.
  for (const loan of data.loans) {
    if (
      plannedLoanIds.has(loan.id) ||
      loan.status !== 'active' ||
      loan.remaining_installments <= 0 ||
      loan.monthly_payment <= 0
    ) {
      continue
    }

    const dueDate = monthlyOccurrenceDate(loan.installment_day, monthStart)
    if (!dueDate) continue

    const offset = monthDistance(fromMonth, monthStart)
    const dueDateValue = dateInputValue(dueDate)
    const startsAfter = loan.start_date ? dueDateValue < loan.start_date : false
    const endsBefore = loan.end_date ? dueDateValue > loan.end_date : false
    if (offset < 0 || offset >= loan.remaining_installments || startsAfter || endsBefore) continue

    addObligation(items, {
      id: `legacy-loan-${loan.id}-${dueDateValue}`,
      kind: 'legacy_loan_installment',
      action: null,
      sourceId: loan.id,
      title: loan.loan_name,
      subtitle: `${loan.bank_name} - plan oluşturulmamış taksit`,
      date: dueDateValue,
      amount: loan.monthly_payment,
      direction: 'outflow',
      isEstimate: true,
    })
  }

  for (const debt of data.debts) {
    if (debt.status !== 'açık' || !debt.due_date || !isDateInMonth(debt.due_date, monthStart)) continue

    const isBorrowed = debt.direction === 'borç_aldım'
    addObligation(items, {
      id: `debt-${debt.id}`,
      kind: isBorrowed ? 'personal_debt' : 'personal_receivable',
      action: isBorrowed ? 'settle_debt' : 'collect_debt',
      sourceId: debt.id,
      title: debt.person_name,
      subtitle: isBorrowed ? 'Kişisel borç' : 'Beklenen tahsilat',
      date: debt.due_date,
      amount: debt.estimated_value_try,
      direction: isBorrowed ? 'outflow' : 'inflow',
      isEstimate: debt.auto_valued,
    })
  }

  if (data.salaryHistory?.length) {
    const monthEnd = endOfMonth(monthStart)
    const salaryRows = [...data.salaryHistory].sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    const salary = salaryRows.filter((row) => row.effective_date <= dateInputValue(monthEnd)).at(-1)
    if (salary && salary.amount > 0) {
      const firstBusinessDay = getFirstBusinessDay(monthStart)
      addObligation(items, {
        id: `salary-${dateInputValue(monthStart)}`,
        kind: 'salary',
        action: null,
        sourceId: salary.id,
        title: salary.title || 'Maaş',
        subtitle: 'Aylık maaş',
        date: dateInputValue(firstBusinessDay),
        amount: salary.amount,
        direction: 'inflow',
      })
    }
  }

  return items.sort((left, right) => (
    left.date.localeCompare(right.date) ||
    left.direction.localeCompare(right.direction) ||
    right.amount - left.amount ||
    left.title.localeCompare(right.title, 'tr')
  ))
}

export function summarizeFinanceObligations(items: FinanceObligation[]): FinanceObligationMonthSummary {
  const outflow = roundTL(sumTL(items.filter((item) => item.direction === 'outflow').map(obligationCashImpact)))
  const inflow = roundTL(sumTL(items.filter((item) => item.direction === 'inflow').map(obligationCashImpact)))

  return {
    outflow,
    inflow,
    net: roundTL(inflow - outflow),
    payableCount: items.filter((item) => item.action).length,
    itemCount: items.length,
  }
}

export function buildFinanceObligationsForRange(
  data: FinanceObligationsInput,
  options: { from?: Date; days?: number } = {},
): FinanceObligation[] {
  const from = startOfDay(options.from ?? new Date())
  const to = addDays(from, Math.max(0, options.days ?? 30))
  const byId = new Map<string, FinanceObligation>()

  for (const month of monthsInRange(from, to)) {
    const monthlyItems = buildFinanceObligationsForMonth(data, month, { from })

    for (const item of monthlyItems) {
      if (!dateIsInRange(item.date, from, to)) continue
      byId.set(item.id, item)
    }
  }

  return Array.from(byId.values()).sort((left, right) => (
    left.date.localeCompare(right.date) ||
    left.direction.localeCompare(right.direction) ||
    right.amount - left.amount ||
    left.title.localeCompare(right.title, 'tr')
  ))
}

export function groupFinanceObligationsByDate(items: FinanceObligation[]) {
  const groups = new Map<string, FinanceObligation[]>()

  for (const item of items) {
    groups.set(item.date, [...(groups.get(item.date) ?? []), item])
  }

  return groups
}
