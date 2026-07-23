import type {
  AccountReconciliation,
  Card,
  CardInstallment,
  CardStatementArchive,
} from '../types/database'
import { scheduledCardInstallmentTotalsByCard } from './financeSummary'
import { moneyDiffers } from './money'

const RECONCILIATION_STALE_DAYS = 7

export type CardBankReconciliationStatus = 'matched' | 'drift' | 'stale' | 'never'

export type CardControlItem = {
  card: Card
  openStatement: CardStatementArchive | null
  scheduledInstallmentTotal: number
  latestReconciliation: AccountReconciliation | null
  reconciliationStatus: CardBankReconciliationStatus
}

function reconciliationAgeDays(reconciledAt: string, now: Date) {
  const reconciledTime = new Date(reconciledAt).getTime()
  if (!Number.isFinite(reconciledTime)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((now.getTime() - reconciledTime) / 86_400_000))
}

export function buildCardControlItems(
  cards: Card[],
  statements: CardStatementArchive[],
  installments: CardInstallment[],
  reconciliations: AccountReconciliation[],
  now = new Date(),
): CardControlItem[] {
  const scheduledByCard = scheduledCardInstallmentTotalsByCard(installments)
  const openStatementsByCard = new Map<string, CardStatementArchive>()
  const latestReconciliationsByCard = new Map<string, AccountReconciliation>()

  for (const statement of statements) {
    if (statement.status !== 'open') continue
    const existing = openStatementsByCard.get(statement.card_id)
    if (!existing || statement.statement_date > existing.statement_date) {
      openStatementsByCard.set(statement.card_id, statement)
    }
  }

  for (const reconciliation of reconciliations) {
    if (reconciliation.target !== 'debt') continue
    const existing = latestReconciliationsByCard.get(reconciliation.card_id)
    if (!existing || reconciliation.reconciled_at > existing.reconciled_at) {
      latestReconciliationsByCard.set(reconciliation.card_id, reconciliation)
    }
  }

  return cards
    .filter((card) => card.card_type === 'kredi_karti')
    .map((card) => {
      const latestReconciliation = latestReconciliationsByCard.get(card.id) ?? null
      let reconciliationStatus: CardBankReconciliationStatus = 'never'

      if (latestReconciliation) {
        if (moneyDiffers(latestReconciliation.app_amount, latestReconciliation.real_amount)) {
          reconciliationStatus = 'drift'
        } else if (reconciliationAgeDays(latestReconciliation.reconciled_at, now) > RECONCILIATION_STALE_DAYS) {
          reconciliationStatus = 'stale'
        } else {
          reconciliationStatus = 'matched'
        }
      }

      return {
        card,
        openStatement: openStatementsByCard.get(card.id) ?? null,
        scheduledInstallmentTotal: scheduledByCard.get(card.id) ?? 0,
        latestReconciliation,
        reconciliationStatus,
      }
    })
    .sort((left, right) => {
      const priority: Record<CardBankReconciliationStatus, number> = {
        drift: 0,
        never: 1,
        stale: 2,
        matched: 3,
      }
      return priority[left.reconciliationStatus] - priority[right.reconciliationStatus]
    })
}
