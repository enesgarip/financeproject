/**
 * Hedef TUTARININ çıpası (saf).
 *
 * "1M TL" üç yıl sonra bugünkü 1M değil. Takip kaynaklarıyla hedefin BİRİKEN
 * tarafı canlandı; bu modül hedef tarafını canlandırır:
 *
 *  - `gold` / `usd`: hedef bugünkü TL ile girilir, o günün kuruyla birime
 *    (gram / USD) çevrilip saklanır; ekranda birim × CANLI kur olarak yürür.
 *    Satın alma gücü korunur ve hiçbir varsayım gömülmez.
 *  - `expense_months`: "acil fonum 6 aylık giderim kadar" — hedef gerçekleşen
 *    aylık nakit çıkışı ortalamasından türer; harcaman büyüdükçe hedef büyür.
 *
 * TÜFE endeksi bilinçli olarak YOK: elle girilen bir enflasyon oranı sayıya
 * gömülmüş bir tahmin, gerçek TÜFE ise yeni bir dış veri kaynağı + bakım olurdu.
 * Altın/dolar zaten canlı ve doğrulanabilir.
 *
 * Çıpalı hedefte `target_amount` DB'de 0'dır; tek doğru tutar burada üretilir.
 */
import type { Card, Payment, SavingsGoal, TransactionHistory } from '../types/database'
import { addMonths, startOfMonth } from './date'
import { formatNumber } from './formatCurrency'
import { unitRate, type MarketRatesSnapshot } from './marketRates'
import { roundTL } from './money'
import { buildRealizedMonthlyOutflow } from './realizedCashFlow'
import { averageOverActiveMonths } from './spendingStats'

/** Çıpanın çözülmesi için gereken canlı girdiler. */
export type GoalTargetContext = {
  snapshot?: MarketRatesSnapshot | null
  /** Gerçekleşen aylık nakit çıkışı ortalaması (expense_months çıpası için). */
  monthlyOutflow?: number | null
}

export type ResolvedGoalTarget = {
  amount: number
  /** Hesapta kullanılan birim fiyat (gram/USD kuru); expense_months'ta aylık gider. */
  unitValue: number
  /** Kur/gider verisi yoksa true — ekran "hesaplanamadı" demeli, 0 göstermemeli. */
  stale: boolean
}

export function goalTargetIsAnchored(goal: Pick<SavingsGoal, 'target_anchor'>): boolean {
  return goal.target_anchor !== 'manual'
}

/**
 * Çıpalı hedefin güncel TL tutarı. Çıpa yoksa null döner (çağıran saklanan
 * `target_amount`'ı kullanır).
 */
export function resolveGoalTarget(
  goal: Pick<SavingsGoal, 'target_anchor' | 'target_anchor_units' | 'target_anchor_months' | 'target_amount'>,
  context: GoalTargetContext,
): ResolvedGoalTarget | null {
  if (goal.target_anchor === 'manual') return null

  if (goal.target_anchor === 'expense_months') {
    const months = goal.target_anchor_months ?? 0
    const outflow = context.monthlyOutflow ?? 0
    if (months <= 0 || !(outflow > 0)) {
      // Gider verisi yoksa hedefi 0 göstermek "hedefe ulaştın" yanılsaması
      // yaratırdı; saklanan değere düşülür ve bayat olduğu söylenir.
      return { amount: roundTL(goal.target_amount), unitValue: 0, stale: true }
    }
    return { amount: roundTL(months * outflow), unitValue: roundTL(outflow), stale: false }
  }

  const units = goal.target_anchor_units ?? 0
  const symbol = goal.target_anchor === 'gold' ? 'GRA' : 'USD'
  // Hedef bir YÜKÜMLÜLÜK değil, ulaşılacak büyüklük: alış tarafı kullanılır
  // (varlık değerlemesiyle aynı taraf, iki ekran farklı sayı göstermesin).
  const rate = unitRate(symbol, context.snapshot, 'buying')

  if (units <= 0 || rate === null) {
    return { amount: roundTL(goal.target_amount), unitValue: 0, stale: true }
  }

  return { amount: roundTL(units * rate), unitValue: rate, stale: false }
}

/** Bugünkü TL tutarını çıpa birimine çevirir (form kaydederken). */
export function goalTargetUnitsFor(
  anchor: SavingsGoal['target_anchor'],
  tryAmount: number,
  snapshot: MarketRatesSnapshot | null | undefined,
): number | null {
  if (anchor !== 'gold' && anchor !== 'usd') return null
  const rate = unitRate(anchor === 'gold' ? 'GRA' : 'USD', snapshot, 'buying')
  if (rate === null || rate <= 0 || !(tryAmount > 0)) return null
  // Birim (gram/USD) — TL değil; money.ts'e bağlanmaz, 4 hane hassasiyet yeter.
  return Math.round((tryAmount / rate) * 10_000) / 10_000
}

export function goalTargetAnchorLabel(goal: Pick<SavingsGoal, 'target_anchor' | 'target_anchor_units' | 'target_anchor_months'>): string | null {
  // Birim 4 haneli saklanır (kur hassasiyeti) ama rozet insan içindir: 2 hane.
  const units = formatNumber(Math.round((goal.target_anchor_units ?? 0) * 100) / 100)
  if (goal.target_anchor === 'gold') return `${units} gram altın karşılığı`
  if (goal.target_anchor === 'usd') return `${units} USD karşılığı`
  if (goal.target_anchor === 'expense_months') return `${goal.target_anchor_months ?? 0} aylık gider`
  return null
}

/**
 * Gerçekleşen aylık nakit çıkışı ortalaması.
 *
 * Cari ay HARİÇ (yarım ay ortalamayı aşağı çeker) ve harcamasız aylar
 * sayılmaz (`averageOverActiveMonths`) — yeni kurulan bir hesapta boş aylar
 * "giderim düşük" yanılsaması yaratırdı.
 */
export function averageMonthlyOutflow(
  history: TransactionHistory[],
  payments: Payment[],
  cards: Array<Pick<Card, 'id' | 'card_type'>> = [],
  monthsBack = 6,
  today: Date = new Date(),
): number {
  const totals: number[] = []
  for (let offset = 1; offset <= monthsBack; offset += 1) {
    const month = addMonths(startOfMonth(today), -offset)
    totals.push(buildRealizedMonthlyOutflow(history, payments, month, cards).totalCash)
  }
  return roundTL(averageOverActiveMonths(totals))
}
