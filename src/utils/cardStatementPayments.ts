/**
 * Kısmi/asgari ekstre ödemesi projeksiyonu (K7, migration 20260812110000).
 *
 * Ekstre arşivinin tutarı DEĞİŞMEZ (guard trigger korur); ödemeler append-only
 * `card_statement_payments` satırlarına yazılır. Dolayısıyla "bu ekstreden ne
 * kaldı" türetilmiş bir değerdir:
 *
 *   kalan(arşiv) = arşiv.statement_debt_amount − Σ ödemeler
 *
 * Kartın ekstre kovası (`cards.statement_debt_amount`) da açık arşivlerin
 * KALANLARININ toplamına projekte edilir — RPC'nin SQL tarafındaki
 * `private.statement_remaining_amount` ikizidir. Ekranlar bu modülden geçmezse
 * kısmen ödenmiş ekstreyi tam tutarıyla gösterir; o yüzden "açık ekstre" rakamı
 * üreten her yüzey buradan okur.
 */
import type { CardStatementArchive, CardStatementPayment } from '../types/database'
import { diffTL, sumTL } from './money'

/** Arşiv id → o arşive yapılmış ödemelerin toplamı (TL). */
export type StatementPaidMap = Map<string, number>

/** Ödeme verisi yüklenmemiş/şemada yokken kullanılan boş harita. */
export const EMPTY_STATEMENT_PAID_MAP: StatementPaidMap = new Map()

export function buildStatementPaidMap(
  payments: Pick<CardStatementPayment, 'statement_archive_id' | 'amount'>[],
): StatementPaidMap {
  const byArchive = new Map<string, number[]>()

  for (const payment of payments) {
    const list = byArchive.get(payment.statement_archive_id)
    if (list) list.push(payment.amount)
    else byArchive.set(payment.statement_archive_id, [payment.amount])
  }

  const paid: StatementPaidMap = new Map()
  for (const [archiveId, amounts] of byArchive) paid.set(archiveId, sumTL(amounts))
  return paid
}

/** Bir arşive yapılmış ödeme toplamı (TL); ödeme yoksa 0. */
export function statementPaidAmount(
  archive: Pick<CardStatementArchive, 'id'>,
  paid: StatementPaidMap = EMPTY_STATEMENT_PAID_MAP,
) {
  return paid.get(archive.id) ?? 0
}

/** Arşivin kalan borcu (TL). Ödemeler tutarı aşarsa 0'a kırpılır. */
export function statementRemainingAmount(
  archive: Pick<CardStatementArchive, 'id' | 'statement_debt_amount'>,
  paid: StatementPaidMap = EMPTY_STATEMENT_PAID_MAP,
) {
  return Math.max(0, diffTL(archive.statement_debt_amount, statementPaidAmount(archive, paid)))
}

/** Açık arşivlerin kalan toplamı; `cardId` verilirse yalnız o kart. */
export function openStatementsRemainingTotal(
  archives: Pick<CardStatementArchive, 'id' | 'card_id' | 'status' | 'statement_debt_amount'>[],
  paid: StatementPaidMap = EMPTY_STATEMENT_PAID_MAP,
  cardId?: string,
) {
  return sumTL(
    archives
      .filter((archive) => archive.status === 'open' && (!cardId || archive.card_id === cardId))
      .map((archive) => statementRemainingAmount(archive, paid)),
  )
}

/** Kalan borcu olan açık arşivler (kısmen ödenip bitmişler listelenmez). */
export function openStatementsWithRemaining<
  T extends Pick<CardStatementArchive, 'id' | 'status' | 'statement_debt_amount'>,
>(archives: T[], paid: StatementPaidMap = EMPTY_STATEMENT_PAID_MAP): T[] {
  return archives.filter((archive) => archive.status === 'open' && statementRemainingAmount(archive, paid) > 0)
}
