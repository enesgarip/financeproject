import type {
  AccountReconciliation,
  Card,
  CardInstallment,
  CardStatementArchive,
  CardStatementPayment,
} from '../types/database'
import { buildStatementPaidMap, statementRemainingAmount } from './cardStatementPayments'
import { scheduledCardInstallmentTotalsByCard } from './financeSummary'
import { sumTL } from './money'
import { isUnresolvedDrift, reconciliationAgeDays, STALE_AFTER_DAYS } from './reconciliation'

export type CardBankReconciliationStatus = 'matched' | 'drift' | 'stale' | 'never'

export type CardControlItem = {
  card: Card
  /**
   * Kartın TÜM açık ekstre arşivlerinin KALAN toplamı (kart listesindeki
   * `visibleOpenStatementAmount` ile aynı formül). Önceden yalnız en yeni açık
   * arşiv gösteriliyordu ve iki panel farklı "açık ekstre" rakamı söylüyordu;
   * kısmi ödemeler de (K7) burada düşülür.
   */
  openStatementAmount: number
  /** Açık ekstreler içinde en yakın (en acil) son ödeme tarihi. */
  openStatementDueDate: string | null
  scheduledInstallmentTotal: number
  latestReconciliation: AccountReconciliation | null
  reconciliationStatus: CardBankReconciliationStatus
}

export function buildCardControlItems(
  cards: Card[],
  statements: CardStatementArchive[],
  installments: CardInstallment[],
  reconciliations: AccountReconciliation[],
  now = new Date(),
  statementPayments: Pick<CardStatementPayment, 'statement_archive_id' | 'amount'>[] = [],
): CardControlItem[] {
  const scheduledByCard = scheduledCardInstallmentTotalsByCard(installments)
  const paidByArchive = buildStatementPaidMap(statementPayments)
  const openStatementsByCard = new Map<string, CardStatementArchive[]>()
  const latestReconciliationsByCard = new Map<string, AccountReconciliation>()

  for (const statement of statements) {
    if (statement.status !== 'open') continue
    const list = openStatementsByCard.get(statement.card_id)
    if (list) list.push(statement)
    else openStatementsByCard.set(statement.card_id, [statement])
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
        // Faz D1: ölçümdeki fark artık düzeltmeden sonra da kayıtta durur, bu
        // yüzden "app ≠ gerçek mi" sorusu tek başına yetmez — kapatılıp
        // kapatılmadığına bakılır (eski kayıtlarda drift'e düşer).
        if (isUnresolvedDrift(latestReconciliation)) {
          reconciliationStatus = 'drift'
        } else if (reconciliationAgeDays(latestReconciliation.reconciled_at, now) > STALE_AFTER_DAYS) {
          reconciliationStatus = 'stale'
        } else {
          reconciliationStatus = 'matched'
        }
      }

      // Kalanı biten (tamamı kısmi ödemelerle kapanmış ama arşivi hâlâ açık)
      // ekstre ne tutara ne vadeye katılır.
      const openStatements = (openStatementsByCard.get(card.id) ?? []).filter(
        (statement) => statementRemainingAmount(statement, paidByArchive) > 0,
      )
      const dueDates = openStatements
        .map((statement) => statement.due_date)
        .filter((dueDate): dueDate is string => Boolean(dueDate))
        .sort()

      return {
        card,
        openStatementAmount: sumTL(openStatements.map((statement) => statementRemainingAmount(statement, paidByArchive))),
        openStatementDueDate: dueDates[0] ?? null,
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
