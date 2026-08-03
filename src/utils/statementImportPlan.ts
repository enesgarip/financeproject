/**
 * Ekstre/hareket import satırının hangi yazma aksiyonuna dönüşeceğine karar
 * veren SAF plancı. Önceden bu karar StatementImportModal içinde inline ve üç
 * yerde tekrarlıydı; buraya alınıp senaryo senaryo test edilir (taksit importu
 * "doğru mu" sorusunun tek kaynağı).
 *
 * Plancı yalnız TUTAR/TARİH/ADET ve aksiyon türünü belirler; description,
 * category, cardId, sourceEventId gibi bağlam alanlarını çağıran (executor)
 * doldurur. Supabase görmez; ledger'a yazma cardsRepo işi.
 */
import { buildImportedInstallmentPlan, checkInstallmentNotation } from './importedInstallmentPlan'

export type StatementImportActionInput = {
  date: string
  amount: number
  isInstallment: boolean
  installmentNo: number
  installmentCount: number
  /**
   * Notasyondaki kalan borç (varsa); `aylık × adet` yeniden kurulumunu bağımsız
   * doğrulamak için. Notasyon yoksa / bilinmiyorsa null.
   */
  remainingDebt?: number | null
}

export type StatementImportAction =
  /** Planlı ödeme eşleşmesi: peşin nakit çıkışı gibi işlenir. */
  | { kind: 'payment'; paymentId: string; amount: number; spentAt: string }
  /** Plan-ortası ya da son taksit: geçmiş taksitler "ödendi", kalan kurulur. */
  | {
      kind: 'carryover'
      installmentAmount: number
      totalInstallments: number
      paidInstallments: number
      nextDueDate: string
    }
  /** Tek çekim/peşin VEYA 1. taksit (tam planı sıfırdan kurar). */
  | { kind: 'expense'; amount: number; spentAt: string; installmentCount: number }
  /**
   * Taksitli ama güvenle otomatik yazılamaz: toplam adet bilinmiyor ya da
   * notasyon kendi içinde tutarsız. Executor bunu YAZMAZ; kullanıcı toplam adedi
   * elle doğrulamalı (manuel akış override ile tekrar plancıya girer).
   */
  | { kind: 'needs-review'; reason: 'unknown-total-installments' | 'inconsistent-notation' }

/**
 * Bir import satırını yazma aksiyonuna çözer.
 *
 * Öncelik sırası:
 *  1. `plannedPaymentId` varsa → planlı ödeme (taksit olsa bile bu öncelikli).
 *  2. Taksitli plan (toplam adet > 1):
 *     - 1. taksit (no=1) → `expense` (toplam tutar + adet, orijinal tarih).
 *     - orta/son taksit (no>1) → `carryover` (no-1 taksit ödenmiş sayılır).
 *  3. Aksi halde tek çekim → `expense` (tutar/tarih olduğu gibi, adet 1).
 *
 * `totalInstallmentsOverride` yalnız manuel akışta gelir (kullanıcı belirsiz
 * toplam adedi elle girer); ekstre akışında ekstredeki adet kullanılır.
 */
export function resolveStatementImportAction(input: {
  transaction: StatementImportActionInput
  plannedPaymentId?: string | null
  totalInstallmentsOverride?: number
}): StatementImportAction {
  const tx = input.transaction

  if (input.plannedPaymentId) {
    return { kind: 'payment', paymentId: input.plannedPaymentId, amount: tx.amount, spentAt: tx.date }
  }

  // Tek çekim / peşin (taksit değil) → doğrudan harcama.
  if (!tx.isInstallment) {
    return { kind: 'expense', amount: tx.amount, spentAt: tx.date, installmentCount: 1 }
  }

  const totalInstallments = input.totalInstallmentsOverride ?? tx.installmentCount

  // Taksitli ama toplam adet PARSER'dan belirsiz (override yok, count ≤ 1) →
  // sessizce aylık tutarla tek-harcama YAZMA (12 taksit küçük bir harcamaya
  // dönüşürdü); manuel doğrulamaya düşür.
  if (input.totalInstallmentsOverride == null && totalInstallments <= 1) {
    return { kind: 'needs-review', reason: 'unknown-total-installments' }
  }

  // Kullanıcı override ile 1 girdiyse "aslında tek çekim" demektir → tek harcama.
  if (totalInstallments <= 1) {
    return { kind: 'expense', amount: tx.amount, spentAt: tx.date, installmentCount: 1 }
  }

  // Notasyon kendi içinde tutarsızsa (kalan ≠ aylık × kalan-adet) adet yanlış
  // okunmuş olabilir → toplamı körlemesine kurma. Override'da kullanıcı adedi
  // zaten elle doğruladığı için bu kontrol atlanır.
  if (input.totalInstallmentsOverride == null && tx.remainingDebt != null) {
    const check = checkInstallmentNotation({
      installmentAmount: tx.amount,
      installmentNo: tx.installmentNo,
      totalInstallments,
      remainingDebt: tx.remainingDebt,
    })
    if (!check.consistent) {
      return { kind: 'needs-review', reason: 'inconsistent-notation' }
    }
  }

  const plan = buildImportedInstallmentPlan({
    originalDate: tx.date,
    installmentNo: tx.installmentNo,
    totalInstallments,
    installmentAmount: tx.amount,
  })

  if (plan.paidInstallments > 0) {
    return {
      kind: 'carryover',
      installmentAmount: tx.amount,
      totalInstallments: plan.totalInstallments,
      paidInstallments: plan.paidInstallments,
      nextDueDate: plan.currentInstallmentDate,
    }
  }

  return {
    kind: 'expense',
    amount: plan.totalAmount,
    spentAt: plan.originalDate,
    installmentCount: plan.totalInstallments,
  }
}
