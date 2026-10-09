/**
 * Kart taksitlerini iki görünüme toplar:
 *  - buildCardInstallmentCalendar    → önümüzdeki N ay, ay başına kart kırılımı
 *    ("Haziran: X bankası 3 taksit Y TL"). Ödenmiş taksitler hariç.
 *  - buildCardInstallmentTotalsByCard → kart başına toplam planlı taksit yükü.
 * Saf gruplama/toplama; tutarlar sumTL ile toplanır.
 */
import type { Card, CardInstallment } from '../types/database'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { sumTL } from './money'

/**
 * Taksit sayısı seçeneklerinin tek kaynağı: provizyon panelinde de, kesinleşmiş
 * hareketi sonradan taksitlendirirken de aynı liste kullanılır.
 */
export const INSTALLMENT_COUNT_OPTIONS = [1, 2, 3, 4, 6, 9, 12] as const

/** Seçenek listesine kayıttaki mevcut (listede olmayan) sayıyı da katar. */
export function installmentChoicesWith(current: number): number[] {
  const options = [...INSTALLMENT_COUNT_OPTIONS]
  return options.includes(current as (typeof INSTALLMENT_COUNT_OPTIONS)[number])
    ? options
    : [...options, current].sort((a, b) => a - b)
}

export type CardInstallmentMonthRow = {
  cardId: string
  cardLabel: string
  amount: number
  count: number
}

export type CardInstallmentMonthSummary = {
  monthKey: string
  monthLabel: string
  total: number
  rows: CardInstallmentMonthRow[]
}

export type CardInstallmentCardTotal = {
  cardId: string
  cardLabel: string
  amount: number
  count: number
}

export type CardInstallmentCardTotalsSummary = {
  total: number
  rows: CardInstallmentCardTotal[]
}

/** Tüm planlı taksitlerden alışveriş dökümü; eski parent kaydı liste limitine takılmaz. */
export function buildUpcomingInstallmentPlans(installments: CardInstallment[]) {
  const plans = new Map<string, { id: string; cardId: string; description: string; items: CardInstallment[]; total: number }>()
  for (const item of installments) {
    if (item.status !== 'scheduled') continue
    // Parent bağlantısı olmayan eski satırları yanlışlıkla aynı alışverişte birleştirme.
    const id = `${item.card_id}:${item.card_expense_id ?? item.id}`
    const existing = plans.get(id)
    if (existing) {
      existing.items.push(item)
      existing.total = sumTL([existing.total, item.amount])
    } else plans.set(id, { id, cardId: item.card_id, description: item.description, items: [item], total: item.amount })
  }
  return Array.from(plans.values()).map((plan) => ({ ...plan, items: plan.items.sort((a, b) => a.due_month.localeCompare(b.due_month)) }))
    .sort((a, b) => b.total - a.total)
}

function monthLabel(monthKey: string) {
  return new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(new Date(`${monthKey}T00:00:00`))
}

function formatCardLabel(card: Card | undefined) {
  return card ? `${card.bank_name} · ${card.card_name}` : 'Kart'
}

export function buildCardInstallmentCalendar(
  installments: CardInstallment[],
  cards: Card[],
  monthCount = 4,
  today: Date = new Date(),
): CardInstallmentMonthSummary[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const start = dateInputValue(startOfMonth(today))
  const monthKeys = Array.from({ length: monthCount }, (_, index) => dateInputValue(addMonths(new Date(`${start}T00:00:00`), index)))

  return monthKeys.map((monthKey) => {
    // Yalnız 'scheduled' (gelecek, henüz borca girmemiş) taksitler. 'posted' zaten
    // kartın dönem-içi/ekstre borcunda sayılıyor; takvime katarsak o ayı çift şişirir
    // ve aynı panelin "kart başına toplam"ı (=== 'scheduled') ile çelişir.
    const monthInstallments = installments.filter((item) => item.status === 'scheduled' && item.due_month.slice(0, 7) === monthKey.slice(0, 7))
    const byCard = new Map<string, CardInstallmentMonthRow>()

    for (const item of monthInstallments) {
      const card = cardsById.get(item.card_id)
      const cardLabel = card ? `${card.bank_name} · ${card.card_name}` : 'Kart'
      const existing = byCard.get(item.card_id)

      if (existing) {
        existing.amount = sumTL([existing.amount, item.amount])
        existing.count += 1
      } else {
        byCard.set(item.card_id, { cardId: item.card_id, cardLabel, amount: item.amount, count: 1 })
      }
    }

    const rows = Array.from(byCard.values()).sort((a, b) => b.amount - a.amount)
    const total = sumTL(rows.map((row) => row.amount))

    return { monthKey, monthLabel: monthLabel(monthKey), total, rows }
  })
}

export function buildCardInstallmentTotalsByCard(
  installments: CardInstallment[],
  cards: Card[],
): CardInstallmentCardTotalsSummary {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const byCard = new Map<string, CardInstallmentCardTotal>()

  for (const item of installments) {
    if (item.status !== 'scheduled') continue
    const card = cardsById.get(item.card_id)
    const existing = byCard.get(item.card_id)

    if (existing) {
      existing.amount = sumTL([existing.amount, item.amount])
      existing.count += 1
    } else {
      byCard.set(item.card_id, { cardId: item.card_id, cardLabel: formatCardLabel(card), amount: item.amount, count: 1 })
    }
  }

  const rows = Array.from(byCard.values()).sort((a, b) => b.amount - a.amount)
  return {
    total: sumTL(rows.map((row) => row.amount)),
    rows,
  }
}

// ── Taksit ödenmişliği (banka modeli) ───────────────────────────────────────
// pay_card_statement taksit satırına bilerek dokunmaz (SI-10: ödenen şey taksit
// değil ekstre arşividir). "Bu taksit ödendi mi?" bu yüzden satır durumundan
// değil kanıttan türetilir: satır paid'e çekildiyse (pay_card_debt tam kapanış),
// erken-ödeme settlement'ına bağlandıysa veya bağlı olduğu ekstre arşivi
// ödendiyse taksit fiilen ödenmiştir.
export type InstallmentSettlementSource = Pick<CardInstallment, 'status'> & {
  current_settlement_id?: string | null
  statement_archive?: { status: string | null } | null
}

export function isInstallmentSettled(item: InstallmentSettlementSource) {
  if (item.status === 'paid') return true
  if (item.current_settlement_id) return true
  return item.statement_archive?.status === 'paid'
}
