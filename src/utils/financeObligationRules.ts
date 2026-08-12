/**
 * Ödeme (Payment) ve kart için tek satırlık, saf iş kuralları.
 *
 * Neden ayrı dosya: hem `obligations.ts` (aylık yükümlülük projeksiyonu) hem
 * `financeSummary.ts` (bilanço/nakit akışı) aynı kuralları kullanır; tek yerde
 * tutmazsak iki yer farklı yorumlar ve dashboard ile analiz tutarsızlaşır.
 * Bu yüzden `financeSummary.ts` bu fonksiyonları re-export eder.
 *
 * Kritik kavram: bir kalemin "tutarı" (amount) ile "nakit etkisi"
 * (cashImpact) aynı şey değildir. Kredi kartına yazılan bir ödeme bu ay
 * bankadan para çıkarmaz; o yüzden nakit etkisi 0'dır (borç karta eklenir,
 * gerçek çıkış ekstre ödenince olur). Bkz. `paymentCashOutflowAmount`.
 */
import type { Card, Payment } from '../types/database'
import { isDateInMonth, monthlyOccurrenceDate } from './date'
import { sumTL } from './money'

// Kartın bu ay ödenecek tutarı = yalnızca kesilmiş ekstre borcu.
// Dönem içi harcama (current_period_spending) henüz ekstreye girmediği için
// bu ay vadesi gelmez; o kalem obligations.ts'te ayrı projekte edilir.
export function cardMonthlyPaymentAmount(card: Pick<Card, 'statement_debt_amount'>) {
  return card.statement_debt_amount
}

// Şu an fiilen ödenebilir kart borcu = ekstre + dönem içi (banka "güncel borç"
// ekranıyla aynı). Provizyon ve gelecek taksitler dahil değildir; `pay_card_debt`
// RPC'sinin sunucu tarafı üst sınırı da budur. Ödeme çekmecesinin tutar tavanı
// bu değeri kullanır — ekstre tutarı yalnız "planlanan" satırıdır, tavan değildir.
export function cardPayableDebt(card: Pick<Card, 'statement_debt_amount' | 'current_period_spending'>) {
  return Math.max(0, sumTL([card.statement_debt_amount, card.current_period_spending]))
}

export function paymentOccurrenceInMonth(payment: Payment, month = new Date()) {
  if (payment.status !== 'bekliyor') return null

  if (payment.recurrence === 'monthly') {
    const occurrence = monthlyOccurrenceDate(payment.recurrence_day, month)
    if (!occurrence) return null

    const dueDate = new Date(`${payment.due_date}T00:00:00`)
    const endDate = payment.recurrence_end_date ? new Date(`${payment.recurrence_end_date}T00:00:00`) : null
    if (occurrence < dueDate) return null
    if (endDate && occurrence > endDate) return null
    return occurrence
  }

  return isDateInMonth(payment.due_date, month) ? new Date(`${payment.due_date}T00:00:00`) : null
}

/** "Bu kart id'si bilinen bir kredi kartı mı?" sorusuna cevap veren predicate. */
export type CreditCardIdCheck = (cardId: string) => boolean

/**
 * Kart listesinden `CreditCardIdCheck` üretir. Liste boşsa `undefined` döner:
 * kartlar henüz yüklenmemiş/bilinmiyor demektir ve çağıran eski varsayıma
 * (talimat kartı = kredi kartı) düşer; boş listeyle her ödemeyi nakit saymak
 * yükleme anında rakamları zıplatırdı.
 */
export function buildCreditCardIdCheck(cards: Array<Pick<Card, 'id' | 'card_type'>>): CreditCardIdCheck | undefined {
  if (cards.length === 0) return undefined
  const creditCardIds = new Set(cards.filter((card) => card.card_type === 'kredi_karti').map((card) => card.id))
  return (cardId) => creditCardIds.has(cardId)
}

// Ödeme bir KREDİ KARTINA talimatlı mı? Böyleyse para bankadan değil karttan
// çıkar → bu ayın nakit çıkışı değil. `isCreditCardId` verilmezse eski varsayım
// korunur: bank_auto + kaynak kart seçili = kredi kartı (form da yalnız kredi
// kartı seçtirir). Verilirse BANKA hesabına talimatlı ödeme normal nakit çıkışı
// sayılır — kart borcuna binmez.
export function paymentUsesCreditCard(
  payment: Pick<Payment, 'payment_method' | 'auto_source_card_id'>,
  isCreditCardId?: CreditCardIdCheck,
) {
  if (payment.payment_method !== 'bank_auto' || !payment.auto_source_card_id) return false
  return isCreditCardId ? isCreditCardId(payment.auto_source_card_id) : true
}

// Bu ay gerçekten bankadan çıkacak nakit. Kredi kartına talimatlıysa 0 (çıkış
// değil, kart borcuna dönüşür; gerçek çıkış o kartın ekstresi ödenince
// gerçekleşir). Nakit akışı/net değer hesapları bunu kullanır; nominal
// `amount`'u değil.
export function paymentCashOutflowAmount(
  payment: Pick<Payment, 'amount' | 'payment_method' | 'auto_source_card_id'>,
  isCreditCardId?: CreditCardIdCheck,
) {
  return paymentUsesCreditCard(payment, isCreditCardId) ? 0 : payment.amount
}
