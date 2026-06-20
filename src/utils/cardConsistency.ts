import type { Card, CardInstallment } from '../types/database'
import { moneyDiffers, exceedsTL, roundTL } from './money'
import {
  clampCardBreakdown,
  cardProvisionAmount,
  cardDebtBreakdown,
  scheduledCardInstallmentTotalsByCard,
} from './financeSummary'
import { ledgerDrift, type CardLedgerEvent } from './cardLedger'
import { balanceDrift, type AccountLedgerEvent } from './accountLedger'

export type ConsistencyScore = {
  score: number
  checks: ConsistencyCheck[]
}

export type ConsistencyCheck = {
  label: string
  ok: boolean
}

export function cardConsistencyScore(
  card: Card,
  cardLedger: CardLedgerEvent[],
  accountLedger: AccountLedgerEvent[],
  cardInstallments: CardInstallment[],
): ConsistencyScore {
  const checks: ConsistencyCheck[] = []

  if (card.card_type === 'kredi_karti') {
    const cardEvents = cardLedger.filter((e) => e.card_id === card.id)
    if (cardEvents.length > 0) {
      checks.push({
        label: 'Borç ↔ ledger',
        ok: ledgerDrift(cardEvents, card.debt_amount) === 0,
      })
    }

    const { statement, provision, current } = clampCardBreakdown(
      card.debt_amount,
      card.statement_debt_amount,
      card.current_period_spending,
      cardProvisionAmount(card),
    )
    checks.push({
      label: 'Borç kırılımı',
      ok: !moneyDiffers(statement, card.statement_debt_amount) &&
          !moneyDiffers(current, card.current_period_spending) &&
          !moneyDiffers(provision, cardProvisionAmount(card)),
    })

    if (card.credit_limit > 0) {
      checks.push({
        label: 'Limit aşımı',
        ok: !exceedsTL(card.debt_amount, card.credit_limit),
      })
    }

    const scheduledByCard = scheduledCardInstallmentTotalsByCard(cardInstallments)
    const breakdown = cardDebtBreakdown(card, scheduledByCard.get(card.id) ?? 0)
    checks.push({
      label: 'Planlı taksit',
      ok: !breakdown.hasScheduledDebtGap,
    })
  }

  if (card.card_type === 'banka_karti') {
    const accountEvents = accountLedger.filter((e) => e.card_id === card.id)
    if (accountEvents.length > 0) {
      checks.push({
        label: 'Bakiye ↔ ledger',
        ok: balanceDrift(accountEvents, card.current_balance) === 0,
      })
    }

    checks.push({
      label: 'Kredi alanları temiz',
      ok: card.credit_limit === 0 && card.debt_amount === 0 && card.statement_debt_amount === 0 && card.current_period_spending === 0,
    })
  }

  const passed = checks.filter((c) => c.ok).length
  const score = checks.length > 0 ? roundTL((passed / checks.length) * 100) : 100

  return { score, checks }
}

export function quickCardConsistencyScore(
  card: Card,
  cardInstallments: CardInstallment[],
): ConsistencyScore {
  return cardConsistencyScore(card, [], [], cardInstallments)
}
