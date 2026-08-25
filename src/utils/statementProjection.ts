/**
 * Önümüzdeki N kesim döneminin ekstre projeksiyonu (saf).
 *
 * E3 (statementEstimate) yalnız CARİ dönemi ve kesime ≤5 gün kala söyler —
 * bilinçli pencere disiplini ("uzak tahmin gürültü olurdu"). Bu modül o kararla
 * çelişmesin diye kart satırında DEĞİL, kullanıcının açtığı detay panelinde
 * yaşar (opt-in) ve '~' dilinde konuşur: toplam yalnız BİLİNEN yüklerdir.
 *
 * Dönem k=0: E3 formülünün aynısı (dönem içi kova + o ekstre ayına planlı
 * taksitler) — abonelik medyanı EKLENMEZ: bu dönem gerçekleşen abonelik zaten
 * kovada, eklemek çift sayardı. k≥1: o aya planlı taksitler + kartın tespit
 * edilmiş abonelik medyanları (buildSubscriptionSummary — yeni/3 aydan genç
 * abonelik eşiğe takılır, projeksiyon bu yüzden sistematik DÜŞÜK kalabilir) +
 * karta talimatlı aylık ödemeler (bank_auto + auto_source_card_id — E4/obligations
 * bunları nakitte 0 sayar, ekstreye yazmak aynı muhasebenin devamı).
 *
 * Tempo tabanı (taksit/abonelik dışı serbest harcama ortalaması) TOPLAMA
 * GİRMEZ — ayrı alan döner, UI ayrı bilgi satırı basar (kullanıcı kararı:
 * "bilinen yükler" savunulabilir kalsın).
 */
import type { Card, CardExpense, CardInstallment, Payment } from '../types/database'
import { getCardStatementPeriod } from './cardStatement'
import { addDays, startOfDay } from './date'
import { roundTL, sumTL } from './money'
import type { SubscriptionItem } from './subscriptions'

const MONTH_LABEL = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' })

export type UpcomingStatementProjection = {
  statementDate: string
  dueDate: string
  /** Ekstre ayının etiketi ("Eylül 2026"). */
  monthLabel: string
  /** O ekstre ayına planlı ('scheduled') taksitlerin toplamı. */
  installmentTotal: number
  /** k≥1: kartın abonelik medyanları + karta talimatlı aylık ödemeler; k=0'da 0. */
  recurringTotal: number
  /** k=0: dönem içi borç kovası; k≥1'de 0. */
  currentPeriod: number
  /** Bilinen yüklerin toplamı (~ dili UI'da). */
  amount: number
}

export function projectUpcomingStatements(
  card: Pick<Card, 'id' | 'card_type' | 'statement_day' | 'due_day' | 'current_period_spending'>,
  installments: CardInstallment[],
  subscriptions: SubscriptionItem[],
  payments: Payment[],
  today: Date = new Date(),
  periods = 3,
): UpcomingStatementProjection[] {
  const cardInstallments = installments.filter(
    (item) => item.card_id === card.id && item.status === 'scheduled',
  )
  // Kart bazlı aylık tekrarlar dönemden bağımsızdır; bir kez hesaplanır.
  const subscriptionTotal = sumTL(
    subscriptions
      .filter((item) => item.isActive && item.source === 'recurring_expense' && item.sourceCardId === card.id)
      .map((item) => item.amount),
  )
  const autoPaymentTotal = sumTL(
    payments
      .filter(
        (payment) =>
          payment.payment_method === 'bank_auto' &&
          payment.auto_source_card_id === card.id &&
          payment.recurrence === 'monthly',
      )
      .map((payment) => payment.amount),
  )
  const recurringMonthly = roundTL(sumTL([subscriptionTotal, autoPaymentTotal]))

  const projections: UpcomingStatementProjection[] = []
  let cursor = today
  for (let index = 0; index < periods; index += 1) {
    const period = getCardStatementPeriod(card, cursor)
    if (!period) return projections

    const statementMonth = period.statementDate.slice(0, 7)
    const installmentTotal = sumTL(
      cardInstallments
        .filter((item) => item.due_month.slice(0, 7) === statementMonth)
        .map((item) => item.amount),
    )
    const currentPeriod = index === 0 ? roundTL(card.current_period_spending) : 0
    const recurringTotal = index === 0 ? 0 : recurringMonthly

    projections.push({
      statementDate: period.statementDate,
      dueDate: period.dueDate,
      monthLabel: MONTH_LABEL.format(new Date(`${period.statementDate.slice(0, 7)}-01T00:00:00`)),
      installmentTotal,
      recurringTotal,
      currentPeriod,
      amount: roundTL(sumTL([currentPeriod, installmentTotal, recurringTotal])),
    })

    // Sonraki dönem: kesim gününün ERTESİ günü referans (purchaseTiming deseni;
    // kesim gününün harcaması o ekstreye dahildir).
    cursor = addDays(startOfDay(new Date(`${period.statementDate}T00:00:00`)), 1)
  }

  return projections
}

/**
 * Serbest harcama tabanı: son 90 günün tek-çekim, kesinleşmiş kart harcaması
 * aylık ortalaması − abonelik/talimat aylık toplamı (çift sayma olmasın).
 * Bilgi satırı içindir, projeksiyon toplamına GİRMEZ. Hiç veri yoksa null.
 */
export function discretionaryMonthlyBase(
  cardId: string,
  expenses: Pick<CardExpense, 'card_id' | 'amount' | 'status' | 'installment_count' | 'spent_at'>[],
  recurringMonthly: number,
  today: Date = new Date(),
): number | null {
  const cutoff = new Date(today.getTime() - 90 * 86_400_000).toLocaleDateString('sv-SE')
  const rows = expenses.filter(
    (expense) =>
      expense.card_id === cardId &&
      expense.status === 'posted' &&
      expense.installment_count <= 1 &&
      expense.spent_at.slice(0, 10) >= cutoff,
  )
  if (rows.length === 0) return null
  const monthly = roundTL(sumTL(rows.map((row) => row.amount)) / 3)
  return Math.max(0, roundTL(monthly - recurringMonthly))
}
