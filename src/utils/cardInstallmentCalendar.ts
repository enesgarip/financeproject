import type { Card, CardInstallment } from '../types/database'
import { addMonths, dateInputValue, startOfMonth } from './date'
import { sumTL } from './money'

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
): CardInstallmentMonthSummary[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]))
  const start = dateInputValue(startOfMonth())
  const monthKeys = Array.from({ length: monthCount }, (_, index) => dateInputValue(addMonths(new Date(`${start}T00:00:00`), index)))

  return monthKeys.map((monthKey) => {
    const monthInstallments = installments.filter((item) => item.status !== 'paid' && item.due_month.slice(0, 7) === monthKey.slice(0, 7))
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
    if (item.status === 'paid') continue
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

export function totalScheduledInstallments(installments: CardInstallment[]) {
  return sumTL(installments.filter((item) => item.status === 'scheduled').map((item) => item.amount))
}
