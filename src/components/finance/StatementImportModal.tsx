import { FileUp, X, Check, CheckCircle2, AlertCircle, Loader2, FileText, ChevronDown } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../ui/use-body-scroll-lock'
import { useCategoryMemory } from '../../hooks/useCategoryMemory'
import {
  addCardExpense,
  cancelCardExpense,
  cutCardStatement,
  fetchCardById,
  fetchCardExpenseMatchRows,
  fetchCardInstallmentMatchRows,
  fetchCardPaymentMatchRows,
  payPaymentFromCardImport,
  recordCardInstallmentCarryover,
  resetCardImportData,
  setStatementReconciliation,
  type ExpenseMatchRow,
  type PaymentMatchRow,
} from '../../data/repositories/cardsRepo'
import { postCardDebtCorrection } from '../../services/cardLedgerActions'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card } from '../../types/database'
import { getCardStatementPeriod } from '../../utils/cardStatement'
import { dateRangeFromIsoDates, rowsInReviewPeriod } from '../../utils/importReviewPeriod'
import {
  parseDenizBankStatement,
  matchTransactions,
  checkStatementInstallments,
  expenseTotalAmount,
  type ParsedTransaction,
  type ParsedStatementAdjustment,
  type StatementTransactionMatch,
  type StatementInstallmentCheckResult,
} from '../../utils/denizBankStatementParser'
import { matchDenizBankMovementPayments, type ParsedDenizBankMovement } from '../../utils/denizBankMovementParser'
import { parseYapiKrediStatement } from '../../utils/yapiKrediStatementParser'
import { resolveStatementImportAction, type StatementImportAction } from '../../utils/statementImportPlan'
import { fail, type Result } from '../../data/result'
import { diffTL, equalsTL, roundTL, sumTL } from '../../utils/money'
import {
  findAppOnlyExpenses,
  isFullyReconciled,
  lockCorrectionNote,
  reconcileResidualTL,
} from '../../utils/statementReconcileReview'
import { checkInstallmentNotation } from '../../utils/importedInstallmentPlan'
import { parseStatementText } from '../../lib/statementParseClient'
import { extractPdfText } from '../../lib/pdfText'
import { CardExpenseHistorySection } from './CardExpenseHistorySection'
import { importedRowEventIds, sha256Hex } from '../../utils/sourceEventId'

/**
 * App'e güvenle otomatik aktarılabilen işlem mi?
 * - Peşin/tek çekim → her zaman aktarılabilir.
 * - Taksitli (toplam sayı biliniyor) → aktarılabilir. 1. taksit tam plan kurar;
 *   plan-ortası (no>1) carryover RPC ile geçmiş taksitleri ödendi olarak ekler;
 *   son taksit (no=count) tek ödeme olarak eklenir.
 * - Toplam sayısı bilinmeyen → manuel kontrol.
 */
function isImportable(tx: ParsedTransaction): boolean {
  if (!tx.isInstallment) return true
  if (tx.installmentCount <= 1) return false
  // Notasyon kendi içinde tutarsızsa (kalan ≠ aylık × kalan-adet) adet yanlış
  // okunmuş olabilir → otomatik yazma, manuel doğrulamaya düşür.
  if (tx.remainingDebt != null) {
    return checkInstallmentNotation({
      installmentAmount: tx.amount,
      installmentNo: tx.installmentNo,
      totalInstallments: tx.installmentCount,
      remainingDebt: tx.remainingDebt,
    }).consistent
  }
  return true
}

// ── Component ─────────────────────────────────────────────────────────────

function appExpenseStatusLabel(status: string) {
  if (status === 'provision') return 'Provizyon'
  if (status === 'posted') return 'Dönem içi'
  if (status === 'cancelled') return 'İptal'
  return status
}

type Step = 'upload' | 'review' | 'success'

type StatementImportRow = {
  selectionKey: string
  sourceEventId: string
  transaction: ParsedTransaction
  plannedPayment: PaymentMatchRow | null
}

type StatementAdjustmentRow = {
  selectionKey: string
  adjustment: ParsedStatementAdjustment
}

// Manuel kontrol gereken (toplam taksiti belirsiz) satır; sourceEventId'yi
// taşır ki inline "elle ekle" idempotent olsun (aynı PDF iki kez yüklense çift
// kayıt olmaz).
type ManualReviewRow = {
  key: string
  transaction: ParsedTransaction
  sourceEventId: string
}

type Props = {
  card: Card
  onClose: () => void
  onSuccess: () => void
}

function transactionMovementAdapter(tx: ParsedTransaction, index: number): ParsedDenizBankMovement {
  return {
    bankStatus: 'posted',
    appStatus: 'posted',
    date: tx.date,
    description: tx.description,
    detail: '',
    cardNo: '',
    cardLastFour: '',
    cardType: '',
    amount: tx.amount,
    bonus: 0,
    category: tx.category,
    isInstallment: tx.isInstallment,
    installmentNo: tx.installmentNo,
    installmentCount: tx.installmentCount,
    rawLine: String(index),
  }
}

function attachPlannedPayments(
  transactions: ParsedTransaction[],
  plannedPayments: PaymentMatchRow[],
  cardId: string,
  sourceEventIds: ReadonlyMap<ParsedTransaction, string>,
): StatementImportRow[] {
  const movementRows = transactions
    .map((transaction, index) => ({ transaction, index }))
    .filter(({ transaction }) => !transaction.isInstallment)
    .map(({ transaction, index }) => transactionMovementAdapter(transaction, index))
  const paymentMatchResult = matchDenizBankMovementPayments(movementRows, plannedPayments, cardId)
  const paymentByIndex = new Map<number, PaymentMatchRow>(
    paymentMatchResult.matches.map(({ movement, payment }) => [Number(movement.rawLine), payment as PaymentMatchRow]),
  )

  return transactions.map((transaction, index) => ({
    selectionKey: `${index}:${transaction.date}:${transaction.amount}:${transaction.description}:${transaction.installmentNo}:${transaction.installmentCount}`,
    sourceEventId: sourceEventIds.get(transaction)!,
    transaction,
    plannedPayment: paymentByIndex.get(index) ?? null,
  }))
}

function attachStatementAdjustments(adjustments: ParsedStatementAdjustment[]): StatementAdjustmentRow[] {
  return adjustments.map((adjustment, index) => ({
    selectionKey: `adjustment:${index}:${adjustment.date}:${adjustment.amount}:${adjustment.description}`,
    adjustment,
  }))
}

/**
 * Plancının (resolveStatementImportAction) verdiği aksiyonu ilgili repo
 * çağrısına yürütür. Karar SAF ve test edilir; burada yalnız bağlam alanları
 * (description/category/sourceEventId) doldurulup yazma yapılır.
 */
function runStatementImportAction(
  action: StatementImportAction,
  ctx: { cardId: string; tx: ParsedTransaction; sourceEventId: string },
): Promise<Result<void>> {
  switch (action.kind) {
    case 'payment':
      return payPaymentFromCardImport({
        paymentId: action.paymentId,
        sourceCardId: ctx.cardId,
        amount: action.amount,
        spentAt: action.spentAt,
        sourceEventId: ctx.sourceEventId,
        source: 'statement_import',
      })
    case 'carryover':
      return recordCardInstallmentCarryover({
        cardId: ctx.cardId,
        description: ctx.tx.description,
        installmentAmount: action.installmentAmount,
        totalInstallments: action.totalInstallments,
        paidInstallments: action.paidInstallments,
        nextDueDate: action.nextDueDate,
        category: ctx.tx.category,
        sourceEventId: ctx.sourceEventId,
      })
    case 'expense':
      return addCardExpense({
        cardId: ctx.cardId,
        amount: action.amount,
        description: ctx.tx.description,
        spentAt: action.spentAt,
        installmentCount: action.installmentCount,
        category: ctx.tx.category,
        status: 'posted',
        source: 'statement_import',
        sourceEventId: ctx.sourceEventId,
      })
    case 'needs-review':
      // Plancı bu satırı güvenle yazamayacağını söyledi (belirsiz adet / tutarsız
      // notasyon). Sessizce yanlış tutar yazmaktansa hata dön; UI manuel yola
      // düşürür. Otomatik akış bu satırları isImportable ile zaten eler.
      return Promise.resolve(
        fail({
          type: 'unknown',
          message:
            action.reason === 'unknown-total-installments'
              ? 'Taksit toplam adedi belirsiz — elle doğrulanmalı.'
              : 'Taksit notasyonu tutarsız — elle doğrulanmalı.',
        }),
      )
  }
}

export function StatementImportModal({ card, onClose, onSuccess }: Props) {
  const { formatAmount } = useBalancePrivacy()
  // Modal açıkken arka plan sayfasının kaymasını engelle (ortak kilit kalıbı).
  useBodyScrollLock(true)

  const [step, setStep] = useState<Step>('upload')
  const cleanImport = false
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const [statementTotal, setStatementTotal] = useState(0)
  const [statementDate, setStatementDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [matched, setMatched] = useState<ParsedTransaction[]>([])
  const [matches, setMatches] = useState<StatementTransactionMatch[]>([])
  const [showMatches, setShowMatches] = useState(false)
  const [periodExpenses, setPeriodExpenses] = useState<ExpenseMatchRow[]>([])
  const [periodLabel, setPeriodLabel] = useState('')
  const [unmatched, setUnmatched] = useState<StatementImportRow[]>([])
  const [adjustments, setAdjustments] = useState<StatementAdjustmentRow[]>([])
  const [manualReview, setManualReview] = useState<ManualReviewRow[]>([])
  const [plannedPaymentMatches, setPlannedPaymentMatches] = useState(0)
  const [matchDriftTL, setMatchDriftTL] = useState(0)
  const [driftCorrected, setDriftCorrected] = useState(false)
  const [installmentCheck, setInstallmentCheck] = useState<StatementInstallmentCheckResult | null>(null)
  const [showInstallmentCheck, setShowInstallmentCheck] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importedCount, setImportedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)

  // Faz 2 — app'te olup ekstrede olmayan "fazla" harcamalar (iptal edilebilir).
  const [appOnly, setAppOnly] = useState<ExpenseMatchRow[]>([])
  const [cancelSelected, setCancelSelected] = useState<Set<string>>(new Set())
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  // Faz 3 — manuel taksitlere inline "elle ekle" (toplam adet girilince importable).
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({})
  const [manualBusyKey, setManualBusyKey] = useState<string | null>(null)
  const [manualAddedKeys, setManualAddedKeys] = useState<Set<string>>(new Set())
  const [manualError, setManualError] = useState('')

  // Faz 1 — banka toplamına kilit (import sonrası taze borç ile kalan fark).
  const [appTotalAfter, setAppTotalAfter] = useState(0)
  const [lockResidualTL, setLockResidualTL] = useState(0)
  const [locking, setLocking] = useState(false)
  const [locked, setLocked] = useState(false)
  const [lockError, setLockError] = useState('')

  const [reconciling, setReconciling] = useState(false)
  const [reconciled, setReconciled] = useState(false)
  const [reconcileError, setReconcileError] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)
  // Geçmiş harcamalardan öğrenilen kategori hafızası: import önerileri de
  // kullanıcının düzeltmelerinden faydalansın (yalnız keyword sözlüğü değil).
  const categoryMemory = useCategoryMemory()

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.pdf')) {
      setParseError('Lütfen bir PDF dosyası seçin.')
      return
    }

    setParsing(true)
    setParseError('')

    try {
      const text = await extractPdfText(file)
      let parsed = parseDenizBankStatement(text, categoryMemory)

      // DenizBank tanınmadıysa YapıKredi'yi dene (cihaz-içi, metin sunucuya gitmez).
      if (!parsed.totalDebt && !parsed.transactions.length) {
        parsed = parseYapiKrediStatement(text, categoryMemory)
      }

      // O da tanınmadıysa banka-bağımsız çözümleyiciye düş (Y3): metin
      // parse-statement edge fonksiyonuna (Gemini) gönderilir.
      if (!parsed.totalDebt && !parsed.transactions.length) {
        parsed = await parseStatementText(text, categoryMemory)
      }

      const artifactHash = await sha256Hex(text)
      const rowEventIds = await importedRowEventIds(artifactHash, parsed.transactions.map((transaction) => JSON.stringify({
        date: transaction.date,
        amount: transaction.amount,
        description: transaction.description,
        installmentNo: transaction.installmentNo,
        installmentCount: transaction.installmentCount,
      })))
      const sourceEventIds = new Map(
        parsed.transactions.map((transaction, index) => [transaction, rowEventIds[index]!] as const),
      )

      if (!parsed.totalDebt && !parsed.transactions.length) {
        setParseError('Ekstre okunamadı veya desteklenmeyen bir format.')
        setParsing(false)
        return
      }

      setStatementTotal(parsed.totalDebt)
      setStatementDate(parsed.statementDate)
      setDueDate(parsed.dueDate)

      // Load existing app expenses once: matching and the period history panel
      // share the same snapshot.
      const [expensesResult, paymentsResult, installmentsResult] = await Promise.all([
        fetchCardExpenseMatchRows(card.id),
        fetchCardPaymentMatchRows(card.id),
        fetchCardInstallmentMatchRows(card.id),
      ])
      if (!expensesResult.ok) {
        setParseError(expensesResult.error.message ?? 'Kart harcamaları yüklenemedi.')
        setParsing(false)
        return
      }
      if (!paymentsResult.ok) {
        setParseError(paymentsResult.error.message ?? 'Planlı ödemeler yüklenemedi.')
        setParsing(false)
        return
      }
      const expenses = expensesResult.data
      const fallbackPeriod = dateRangeFromIsoDates(parsed.transactions.map((tx) => tx.date))
      const periodAnchor = parsed.statementDate || fallbackPeriod?.end || null
      const cardPeriod = getCardStatementPeriod(card, periodAnchor)
      const reviewPeriod = cardPeriod
        ? { start: cardPeriod.periodStart, end: cardPeriod.periodEnd, label: cardPeriod.periodLabel }
        : fallbackPeriod

      setPeriodLabel(reviewPeriod?.label ?? '')
      setPeriodExpenses(rowsInReviewPeriod(expenses, reviewPeriod))

      if (installmentsResult.ok) {
        const instCheck = checkStatementInstallments(parsed.transactions, installmentsResult.data, parsed.statementDate)
        const hasIssues = instCheck.amountMismatches.length > 0 || instCheck.appOnly.length > 0
        setInstallmentCheck(instCheck)
        setShowInstallmentCheck(hasIssues)
      }

      if (cleanImport) {
        const importRows = attachPlannedPayments(parsed.transactions, paymentsResult.data, card.id, sourceEventIds)
        const adjustmentRows = attachStatementAdjustments(parsed.adjustments ?? [])

        setMatched([])
        setMatches([])
        setShowMatches(false)
        setUnmatched(importRows)
        setAdjustments(adjustmentRows)
        setManualReview([])
        setPlannedPaymentMatches(importRows.filter(({ plannedPayment }) => plannedPayment).length)
        setSelected(new Set())
        setStep('review')
        return
      }

      const result = matchTransactions(parsed.transactions, expenses)

      // App'te olmayan işlemleri ikiye ayır: otomatik aktarılabilir olanlar ve
      // plan-ortası/eksik bilgili taksitler (manuel kontrol gerektirir).
      const importable = result.unmatched.filter(isImportable)
      const manual: ManualReviewRow[] = result.unmatched
        .filter((tx) => !isImportable(tx))
        .map((transaction, index) => ({
          key: `manual:${index}:${transaction.date}:${transaction.amount}:${transaction.description}`,
          transaction,
          sourceEventId: sourceEventIds.get(transaction)!,
        }))
      const importRows = attachPlannedPayments(importable, paymentsResult.data, card.id, sourceEventIds)
      const adjustmentRows = attachStatementAdjustments(parsed.adjustments ?? [])

      // Ekstre satırlarıyla eşleşen app harcamalarının id'leri; dönemdeki geri
      // kalan tek-çekim posted kayıtlar "app'te fazla" (ekstrede yok) demektir.
      const matchedExpenseIds = new Set(result.matches.map((match) => (match.expense as ExpenseMatchRow).id))
      const appOnlyRows = findAppOnlyExpenses(rowsInReviewPeriod(expenses, reviewPeriod), matchedExpenseIds)

      setMatched(result.matched)
      setMatches(result.matches)
      setMatchDriftTL(result.matchDriftTL)
      setShowMatches(false)
      setUnmatched(importRows)
      setAdjustments(adjustmentRows)
      setManualReview(manual)
      setAppOnly(appOnlyRows)
      setCancelSelected(new Set())
      setCancelledIds(new Set())
      setManualDrafts({})
      setManualAddedKeys(new Set())
      setPlannedPaymentMatches(importRows.filter(({ plannedPayment }) => plannedPayment).length)
      setSelected(new Set())
      setStep('review')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setParsing(false)
    }
  }, [card, cleanImport, categoryMemory])

  function reconcilePeriodDate() {
    if (cleanImport) return new Date()
    return statementDate ? new Date(`${statementDate}T00:00:00`) : new Date()
  }

  async function handleCleanImport() {
    const toImport = unmatched.filter((item) => selected.has(item.selectionKey))
    const toAdjust = adjustments.filter((item) => selected.has(item.selectionKey))
    if (!toImport.length && !toAdjust.length) return

    setImporting(true)
    setImportError('')

    const resetResult = await resetCardImportData(card.id)
    if (!resetResult.ok) {
      setImportError(`Sıfırlama başarısız: ${resetResult.error.message ?? 'Bilinmeyen hata.'}`)
      setImporting(false)
      return
    }

    let successCount = 0
    const errors: string[] = []

    for (const item of toImport) {
      const { transaction: tx, plannedPayment, sourceEventId } = item
      const action = resolveStatementImportAction({ transaction: tx, plannedPaymentId: plannedPayment?.id })
      const result = await runStatementImportAction(action, { cardId: card.id, tx, sourceEventId })
      if (!result.ok) errors.push(`${tx.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    for (const item of toAdjust) {
      const { adjustment } = item
      const result = await postCardDebtCorrection(
        card.id,
        -adjustment.amount,
        `Ekstre import alacak/iade: ${adjustment.description} (${adjustment.date})`,
      )
      if (result.error) errors.push(`${adjustment.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    setImportedCount(successCount)
    setFailedCount(errors.length)

    if (!successCount) {
      setImportError(`İçe aktarma başarısız: ${errors[0] ?? 'Bilinmeyen hata.'}`)
      setImporting(false)
      return
    }

    if (errors.length) {
      setImportError(`${errors.length} işlem aktarılamadı: ${errors[0]}`)
    }

    const cutResult = await cutCardStatement(card.id)
    if (!cutResult.ok) {
      setImportError(`Ekstre kesilemedi: ${cutResult.error.message ?? 'Bilinmeyen hata.'}`)
      setImporting(false)
      return
    }

    if (statementTotal) {
      const period = reconcilePeriodDate()
      const reconcileResult = await setStatementReconciliation({
        cardId: card.id,
        periodYear: period.getFullYear(),
        periodMonth: period.getMonth() + 1,
        bankAmount: statementTotal,
        note: null,
      })
      if (reconcileResult.ok) setReconciled(true)
    }

    setImporting(false)
    setStep('success')
  }

  async function handleImport() {
    if (cleanImport) {
      await handleCleanImport()
      return
    }

    const toImport = unmatched.filter((item) => selected.has(item.selectionKey))
    const toAdjust = adjustments.filter((item) => selected.has(item.selectionKey))
    if (!toImport.length && !toAdjust.length) return

    setImporting(true)
    setImportError('')

    let successCount = 0
    const errors: string[] = []

    for (const item of toImport) {
      const { transaction: tx, plannedPayment, sourceEventId } = item
      const action = resolveStatementImportAction({ transaction: tx, plannedPaymentId: plannedPayment?.id })
      const result = await runStatementImportAction(action, { cardId: card.id, tx, sourceEventId })
      if (!result.ok) errors.push(`${tx.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    for (const item of toAdjust) {
      const { adjustment } = item
      const result = await postCardDebtCorrection(
        card.id,
        -adjustment.amount,
        `Ekstre import alacak/iade: ${adjustment.description} (${adjustment.date})`,
      )
      if (result.error) errors.push(`${adjustment.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    setImportedCount(successCount)
    setFailedCount(errors.length)

    if (errors.length && !successCount) {
      setImportError(`İçe aktarma başarısız: ${errors[0]}`)
      setImporting(false)
      return
    }

    if (errors.length) {
      setImportError(`${errors.length} işlem aktarılamadı: ${errors[0]}`)
    }

    if (matchDriftTL !== 0) {
      const correction = await postCardDebtCorrection(
        card.id,
        -matchDriftTL,
        `Ekstre import eslesmelerindeki tutar farki duzeltmesi (${matched.length} islem, toplam ${matchDriftTL > 0 ? '+' : ''}${roundTL(matchDriftTL)} TL fark)`,
      )
      if (!correction.error) setDriftCorrected(true)
    }

    // Import + tüm düzeltmeler sonrası TAZE borç kovalarını oku; banka toplamına
    // kalan farkı hesapla. Kilit adımı success ekranında sunulur (son hamle).
    if (statementTotal > 0) {
      const fresh = await fetchCardById(card.id)
      if (fresh.ok) {
        const total = sumTL([fresh.data.statement_debt_amount, fresh.data.current_period_spending])
        setAppTotalAfter(total)
        setLockResidualTL(reconcileResidualTL(statementTotal, total))
      }
    }

    setImporting(false)
    setStep('success')
  }

  async function handleCancelAppOnly() {
    const ids = appOnly
      .filter((expense) => cancelSelected.has(expense.id) && !cancelledIds.has(expense.id))
      .map((expense) => expense.id)
    if (!ids.length) return

    setCancelling(true)
    setCancelError('')
    const done = new Set(cancelledIds)
    const errors: string[] = []
    for (const id of ids) {
      const result = await cancelCardExpense(id)
      if (result.ok) done.add(id)
      else errors.push(result.error.message ?? 'İptal edilemedi.')
    }
    setCancelledIds(done)
    setCancelSelected(new Set())
    if (errors.length) setCancelError(`${errors.length} kayıt iptal edilemedi: ${errors[0]}`)
    setCancelling(false)
  }

  async function handleAddManual(row: ManualReviewRow) {
    const totalInstallments = Number(manualDrafts[row.key] ?? '')
    if (!Number.isInteger(totalInstallments) || totalInstallments < 1) {
      setManualError('Geçerli bir toplam taksit sayısı gir (1 veya üzeri).')
      return
    }

    setManualBusyKey(row.key)
    setManualError('')
    const tx = row.transaction
    const action = resolveStatementImportAction({ transaction: tx, totalInstallmentsOverride: totalInstallments })
    const result = await runStatementImportAction(action, { cardId: card.id, tx, sourceEventId: row.sourceEventId })
    if (!result.ok) {
      setManualError(`${tx.description}: ${result.error.message ?? 'Eklenemedi.'}`)
      setManualBusyKey(null)
      return
    }
    setManualAddedKeys((prev) => new Set(prev).add(row.key))
    setManualBusyKey(null)
  }

  async function handleLock() {
    if (!statementTotal || isFullyReconciled(statementTotal, appTotalAfter)) return

    setLocking(true)
    setLockError('')
    const residual = reconcileResidualTL(statementTotal, appTotalAfter)
    const result = await postCardDebtCorrection(card.id, residual, lockCorrectionNote(residual, periodLabel))
    if (result.error) {
      setLockError(result.error.message ?? 'Kilit uygulanamadı.')
      setLocking(false)
      return
    }
    setAppTotalAfter(statementTotal)
    setLockResidualTL(0)
    setLocked(true)
    setLocking(false)
  }

  async function handleReconcile() {
    setReconciling(true)
    setReconcileError('')

    const period = reconcilePeriodDate()
    const result = await setStatementReconciliation({
      cardId: card.id,
      periodYear: period.getFullYear(),
      periodMonth: period.getMonth() + 1,
      bankAmount: statementTotal,
      note: null,
    })

    if (!result.ok) setReconcileError(result.error.message ?? 'Mutabakat kaydedilemedi.')
    else setReconciled(true)
    setReconciling(false)
  }

  function toggleAll() {
    const keys = [...unmatched.map((item) => item.selectionKey), ...adjustments.map((item) => item.selectionKey)]
    if (selected.size === keys.length) setSelected(new Set())
    else setSelected(new Set(keys))
  }

  function toggleRow(selectionKey: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(selectionKey)) next.delete(selectionKey)
      else next.add(selectionKey)
      return next
    })
  }

  function toggleCancel(id: string) {
    setCancelSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function formatShortDate(iso: string) {
    if (!iso) return '-'
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
  }

  const appCardDebt = sumTL([card.statement_debt_amount, card.current_period_spending])
  const diff = diffTL(statementTotal, appCardDebt)
  const importableCount = unmatched.length + adjustments.length

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-sm sm:items-center sm:p-6">
      <div className="max-h-[88svh] w-full max-w-lg overflow-x-hidden overflow-y-auto rounded-2xl bg-card shadow-xl sm:max-h-[92svh]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <span className="text-sm font-black text-foreground">Ekstre İçe Aktar</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
              **** {card.card_name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-lg hover:bg-muted"
          >
            <X size={15} />
          </button>
        </div>

        {/* Upload step */}
        {step === 'upload' && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Kredi kartı ekstre PDF'ini yükle. DenizBank ve YapıKredi ekstreleri tamamen
              cihazında okunur; diğer bankalarda metin yalnız çözümleme için sunucuya gönderilir, saklanmaz.
            </p>

            <button
              type="button"
              disabled={parsing}
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 p-6 transition hover:bg-muted/50 disabled:opacity-60"
            >
              {parsing ? (
                <Loader2 size={24} className="animate-spin text-primary" />
              ) : (
                <FileUp size={24} className="text-muted-foreground" />
              )}
              <span className="text-sm font-bold text-foreground">
                {parsing ? 'PDF okunuyor…' : 'PDF seç'}
              </span>
              <span className="text-xs text-muted-foreground">kk_hesap_ekstresi_*.pdf</span>
            </button>

            <p className="rounded-xl border border-success/20 bg-success/8 p-3 text-xs text-success">
              Güvenli eşleştirme kullanılır; geçmiş kayıtlar silinmez, yalnız eksik seçili ekstre satırları eklenir.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />

            {parseError && (
              <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle size={15} className="shrink-0" />
                {parseError}
              </p>
            )}
          </div>
        )}

        {/* Review step */}
        {step === 'review' && (
          <div className="flex max-h-[75vh] flex-col">
            {cleanImport && (
              <p className="flex items-start gap-2 border-b border-border bg-warning/10 px-4 py-3 text-xs font-bold text-warning">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                Açık/güncel kart harcama ve taksitleri seçili PDF satırlarıyla yeniden kurulacak. Tüm ödenmiş ekstre arşivleri ve bağlı geçmiş kayıtlar korunur.
              </p>
            )}
            {/* Reconciliation summary */}
            <div className="border-b border-border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Ekstre kesim</p>
                  <p className="mt-0.5 font-black text-foreground">{formatShortDate(statementDate)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Son ödeme</p>
                  <p className="mt-0.5 font-black text-foreground">{formatShortDate(dueDate)}</p>
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bankadan gelen</span>
                  <span className="font-black text-foreground">{formatAmount(statementTotal)}</span>
                </div>
                {!cleanImport && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">App hesabı</span>
                      <span className="font-black text-foreground">{formatAmount(appCardDebt)}</span>
                    </div>
                    <div className="h-px bg-border" />
                    <div className="flex justify-between">
                      <span className="font-bold text-muted-foreground">Fark</span>
                      <span className={`font-black ${equalsTL(statementTotal, appCardDebt) ? 'text-success' : 'text-destructive'}`}>
                        {diff >= 0 ? '+' : ''}{formatAmount(diff)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {!cleanImport && (
                <button
                  type="button"
                  disabled={reconciling || reconciled || !statementTotal}
                  onClick={() => void handleReconcile()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-xs font-black text-foreground transition hover:bg-muted/50 disabled:opacity-55"
                >
                  {reconciling && <Loader2 size={13} className="animate-spin" />}
                  {reconciled ? (
                    <>
                      <CheckCircle2 size={13} className="text-success" /> Mutabık kaydedildi
                    </>
                  ) : reconciling ? (
                    'Kaydediliyor…'
                  ) : (
                    'Bu ekstreyi mutabık olarak kaydet'
                  )}
                </button>
              )}

              {reconcileError && (
                <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive">
                  <AlertCircle size={13} className="shrink-0" />
                  {reconcileError}
                </p>
              )}

              {!cleanImport && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 font-bold text-success">
                    <CheckCircle2 size={12} />
                    {matched.length} eşleşti
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-warning/10 px-2 py-1 font-bold text-warning">
                    <AlertCircle size={12} />
                    {unmatched.length} eksik
                  </span>
                  {adjustments.length > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-info/10 px-2 py-1 font-bold text-info">
                      <CheckCircle2 size={12} />
                      {adjustments.length} alacak/iade
                    </span>
                  )}
                  {plannedPaymentMatches > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-info/10 px-2 py-1 font-bold text-info">
                      <CheckCircle2 size={12} />
                      {plannedPaymentMatches} planlı ödeme
                    </span>
                  )}
                  {manualReview.length > 0 && (
                    <span className="flex items-center gap-1 rounded-md bg-info/10 px-2 py-1 font-bold text-info">
                      <AlertCircle size={12} />
                      {manualReview.length} manuel
                    </span>
                  )}
                </div>
              )}
            </div>

            <CardExpenseHistorySection expenses={periodExpenses} periodLabel={periodLabel} />

            {!cleanImport && matches.length > 0 && (
              <div className="border-b border-border">
                <button
                  type="button"
                  onClick={() => setShowMatches((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/30"
                  aria-expanded={showMatches}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-muted-foreground">Eşleşen kayıtlar</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {matches.length} kayıt gizli. Ekstre işlemi ile app'teki kaydı birlikte görmek için aç.
                    </span>
                  </span>
                  <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${showMatches ? 'rotate-180' : ''}`} />
                </button>
                {showMatches ? (
                  <div className="max-h-48 overflow-y-auto">
                    {matches.map(({ transaction, expense }, index) => {
                      const bankTotal = expenseTotalAmount(transaction)
                      return (
                        <div
                          key={`${transaction.date}-${transaction.description}-${transaction.amount}-${index}`}
                          className="border-b border-border/50 px-4 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-foreground">{transaction.description}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Ekstre: {formatShortDate(transaction.date)} · {transaction.category}
                                {transaction.isInstallment ? ` · ${transaction.installmentNo}${transaction.installmentCount ? `/${transaction.installmentCount}` : ''}. taksit` : ''}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                App: {expense.description || 'Açıklama yok'} · {formatShortDate(expense.spent_at)} · {appExpenseStatusLabel(expense.status)}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs font-black text-foreground">{formatAmount(bankTotal)}</p>
                              <p className="text-[10px] font-bold text-muted-foreground">App {formatAmount(expense.amount)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )}

            {/* Taksit kontrolü */}
            {installmentCheck && (installmentCheck.matched.length > 0 || installmentCheck.amountMismatches.length > 0 || installmentCheck.appOnly.length > 0) && (
              <div className="border-b border-border">
                <button
                  type="button"
                  onClick={() => setShowInstallmentCheck((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/30"
                  aria-expanded={showInstallmentCheck}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-muted-foreground">Taksit kontrolü</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {installmentCheck.matched.length} doğrulandı
                      {installmentCheck.amountMismatches.length > 0 && `, ${installmentCheck.amountMismatches.length} tutar farkı`}
                      {installmentCheck.appOnly.length > 0 && `, ${installmentCheck.appOnly.length} ekstre dışı`}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    {installmentCheck.amountMismatches.length > 0 || installmentCheck.appOnly.length > 0 ? (
                      <span className="flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-black text-warning">
                        <AlertCircle size={10} />
                        {installmentCheck.amountMismatches.length + installmentCheck.appOnly.length}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-black text-success">
                        <CheckCircle2 size={10} />
                        OK
                      </span>
                    )}
                    <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${showInstallmentCheck ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {showInstallmentCheck && (
                  <div className="max-h-56 overflow-y-auto">
                    {installmentCheck.amountMismatches.map(({ transaction: tx, installment: inst, diffTL: diff }) => (
                      <div
                        key={inst.id}
                        className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{tx.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {tx.installmentNo}/{tx.installmentCount}. taksit · Ekstre: {formatAmount(tx.amount)} · App: {formatAmount(inst.amount)}
                          </p>
                          <p className="text-[11px] font-bold text-warning">
                            Fark: {diff > 0 ? '+' : ''}{formatAmount(diff)}
                          </p>
                        </div>
                        <span className="shrink-0 text-right text-[11px] font-bold text-muted-foreground">
                          {inst.statement_archive_id !== null || inst.status === 'paid'
                            ? 'Arşiv kaydı değiştirilemez'
                            : 'Manuel uzlaştırma gerekli'}
                        </span>
                      </div>
                    ))}
                    {installmentCheck.appOnly.map((inst) => (
                      <div
                        key={inst.id}
                        className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{inst.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {inst.installment_no}/{inst.installment_count}. taksit · {formatAmount(inst.amount)}/ay
                          </p>
                          <p className="text-[11px] font-bold text-warning">
                            Ekstrede yok — kontrol et
                          </p>
                        </div>
                      </div>
                    ))}
                    {installmentCheck.matched.map(({ transaction: tx, installment: inst }) => (
                      <div
                        key={inst.id}
                        className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{tx.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {tx.installmentNo}/{tx.installmentCount}. taksit · {formatAmount(tx.amount)}/ay
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-bold text-success">
                          <CheckCircle2 size={12} className="inline" /> OK
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Faz 2 — App'te fazla (ekstrede yok): iptal edilebilir */}
            {appOnly.length > 0 && (
              <div className="border-b border-border">
                <div className="px-4 py-2">
                  <span className="text-xs font-bold text-warning">App'te fazla (ekstrede yok)</span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Bu dönem app'te olup ekstrede olmayan harcamalar (mükerrer / iptal edilmemiş). İptal edersen app bakiyesi bankayla eşleşir.
                  </p>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {appOnly.map((expense) => {
                    const isCancelled = cancelledIds.has(expense.id)
                    const isSel = cancelSelected.has(expense.id)
                    return (
                      <button
                        type="button"
                        key={expense.id}
                        data-testid="statement-import-apponly-row"
                        disabled={isCancelled}
                        onClick={() => toggleCancel(expense.id)}
                        aria-pressed={isSel}
                        className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/30 disabled:opacity-55"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-4 shrink-0 place-items-center rounded border ${
                            isSel ? 'border-destructive bg-destructive text-white' : 'border-border bg-background'
                          }`}
                        >
                          {isSel ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{expense.description || 'Açıklama yok'}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatShortDate(expense.spent_at)} · {expense.category ?? 'Diğer'}
                            {isCancelled ? ' · iptal edildi' : ''}
                          </p>
                        </div>
                        <span className={`shrink-0 text-right text-xs font-black ${isCancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {formatAmount(expense.amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {cancelError && (
                  <p className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />
                    {cancelError}
                  </p>
                )}
                <div className="p-4">
                  <button
                    type="button"
                    disabled={cancelSelected.size === 0 || cancelling}
                    onClick={() => void handleCancelAppOnly()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 py-2.5 text-xs font-black text-destructive transition hover:bg-destructive/10 disabled:opacity-55"
                  >
                    {cancelling && <Loader2 size={13} className="animate-spin" />}
                    {cancelling ? 'İptal ediliyor…' : `Seçili ${cancelSelected.size} kaydı iptal et`}
                  </button>
                </div>
              </div>
            )}

            {/* Importable (otomatik aktarılabilir) işlemler */}
            {importableCount > 0 && (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">
                    {cleanImport ? 'İçe aktarılacak ekstre satırları' : "App'te olmayan işlemler ve alacaklar"}
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-bold text-primary"
                  >
                    {selected.size === importableCount ? 'Tümünü kaldır' : 'Tümünü seç'}
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto">
                  {unmatched.map((item) => {
                    const { transaction: tx, plannedPayment } = item
                    const knownPlan = tx.isInstallment && tx.installmentCount > 1
                    const isMidPlan = knownPlan && tx.installmentNo > 1 && tx.installmentNo < tx.installmentCount
                    const isLastInstallment = knownPlan && tx.installmentNo === tx.installmentCount
                    // Plan-ortası devirde kalan adet hesaplanır.
                    const remainingCount = Math.max(1, tx.installmentCount - tx.installmentNo)
                    const planCount = cleanImport && knownPlan
                      ? Math.max(1, tx.installmentCount - tx.installmentNo + 1)
                      : isMidPlan && knownPlan
                        ? remainingCount
                        : tx.installmentCount
                    const rowTotal = knownPlan && !isLastInstallment
                      ? roundTL(tx.amount * planCount)
                      : tx.amount
                    const isSelected = selected.has(item.selectionKey)
                    return (
                      <button
                        type="button"
                        key={item.selectionKey}
                        data-testid="statement-import-row"
                        onClick={() => toggleRow(item.selectionKey)}
                        aria-pressed={isSelected}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/30"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-4 shrink-0 place-items-center rounded border ${
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background'
                          }`}
                        >
                          {isSelected ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{tx.description}</p>
                          {plannedPayment ? (
                            <span className="mt-1 inline-flex rounded-md bg-info/10 px-2 py-0.5 text-[10px] font-black text-info">
                              Planlı ödeme
                            </span>
                          ) : null}
                          {plannedPayment ? (
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {formatShortDate(tx.date)} · {tx.category} · Plan: {plannedPayment.title} · vade {formatShortDate(plannedPayment.due_date)}
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              {formatShortDate(tx.date)} · {tx.category}
                              {tx.isInstallment ? ` · ${
                                isLastInstallment ? `${tx.installmentNo}/${tx.installmentCount} son taksit`
                                : (cleanImport || isMidPlan) && knownPlan ? `${tx.installmentNo}/${tx.installmentCount}. taksit, ${planCount} kalan`
                                : `${tx.installmentCount} taksit`
                              }` : ''}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-right text-xs font-black text-foreground">
                          {formatAmount(rowTotal)}
                          {tx.isInstallment && (
                            <span className="block text-[10px] font-bold text-muted-foreground">
                              {formatAmount(tx.amount)}/ay
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                  {adjustments.map((item) => {
                    const { adjustment } = item
                    const isSelected = selected.has(item.selectionKey)
                    return (
                      <button
                        type="button"
                        key={item.selectionKey}
                        data-testid="statement-import-adjustment-row"
                        onClick={() => toggleRow(item.selectionKey)}
                        aria-pressed={isSelected}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/30"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-4 shrink-0 place-items-center rounded border ${
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background'
                          }`}
                        >
                          {isSelected ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{adjustment.description}</p>
                          <span className="mt-1 inline-flex rounded-md bg-info/10 px-2 py-0.5 text-[10px] font-black text-info">
                            Ekstre alacağı/iade
                          </span>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {formatShortDate(adjustment.date)} · {adjustment.category}
                          </p>
                        </div>
                        <span className="shrink-0 text-right text-xs font-black text-success">
                          -{formatAmount(adjustment.amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {importError && (
                  <p className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle size={13} className="shrink-0" />
                    {importError}
                  </p>
                )}

                <div className="border-t border-border p-4">
                  <button
                    type="button"
                    disabled={selected.size === 0 || importing}
                    onClick={() => void handleImport()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-55"
                  >
                    {importing && <Loader2 size={15} className="animate-spin" />}
                    {importing
                      ? 'İçe aktarılıyor…'
                      : `${selected.size} satırı içe aktar`}
                  </button>
                </div>
              </>
            )}

            {/* Faz 3 — Manuel kontrol: toplam taksit girilince inline eklenir */}
            {manualReview.length > 0 && (
              <div className="border-t border-border">
                <div className="px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">Manuel kontrol gerekli</span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Toplam taksiti belirsiz işlemler. Toplam taksit sayısını gir, buradan ekle (Kartlar'a gitmeye gerek yok).
                  </p>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {manualReview.map((row) => {
                    const tx = row.transaction
                    const added = manualAddedKeys.has(row.key)
                    const busy = manualBusyKey === row.key
                    return (
                      <div key={row.key} className="border-b border-border/50 px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold text-foreground">{tx.description}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatShortDate(tx.date)} · {tx.category}
                              {tx.isInstallment
                                ? ` · ${tx.installmentNo}${tx.installmentCount ? `/${tx.installmentCount}` : ''}. taksit`
                                : ''}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-black text-foreground">
                            {formatAmount(tx.amount)}
                            <span className="block text-[10px] font-bold text-muted-foreground">/ay</span>
                          </span>
                        </div>
                        {added ? (
                          <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-success">
                            <CheckCircle2 size={12} /> Eklendi
                          </p>
                        ) : (
                          <div className="mt-2 flex items-center gap-2">
                            <label className="text-[11px] text-muted-foreground">Toplam taksit</label>
                            <input
                              type="number"
                              min={1}
                              inputMode="numeric"
                              value={manualDrafts[row.key] ?? ''}
                              onChange={(e) => setManualDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
                              placeholder={tx.installmentNo ? `≥${tx.installmentNo}` : '1'}
                              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs font-bold text-foreground"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleAddManual(row)}
                              className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-black text-primary-foreground disabled:opacity-55"
                            >
                              {busy && <Loader2 size={12} className="animate-spin" />}
                              {busy ? 'Ekleniyor…' : 'Elle ekle'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {manualError && (
                  <p className="mx-4 my-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />
                    {manualError}
                  </p>
                )}
              </div>
            )}

            {/* Hiç eksik yok */}
            {importableCount === 0 && manualReview.length === 0 && appOnly.length === 0 && (
              <div className="p-6 text-center">
                <CheckCircle2 size={32} className="mx-auto text-success" />
                <p className="mt-2 text-sm font-bold text-foreground">Tüm işlemler app'te zaten kayıtlı</p>
                <p className="mt-1 text-xs text-muted-foreground">Mutabakat tamam.</p>
              </div>
            )}

            {/* İçe aktarılacak bir şey yokken kapat butonu */}
            {importableCount === 0 && (
              <div className="border-t border-border p-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
                >
                  Kapat
                </button>
              </div>
            )}
          </div>
        )}

        {/* Success step */}
        {step === 'success' && (
          <div className="p-6 text-center space-y-3">
            <CheckCircle2 size={40} className={`mx-auto ${failedCount > 0 ? 'text-warning' : 'text-success'}`} />
            <p className="text-base font-black text-foreground">
              {importedCount} işlem içe aktarıldı
            </p>
            {failedCount > 0 ? (
              <p className="text-sm font-medium text-warning">
                {failedCount} işlem aktarılamadı. Kartlar ekranından kontrol et.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Kart bakiyesi güncellendi.
              </p>
            )}
            {driftCorrected && (
              <p className="text-sm text-info">
                Eşleşen işlemlerdeki {formatAmount(Math.abs(matchDriftTL))} tutar farkı otomatik düzeltildi.
              </p>
            )}

            {/* Faz 1 — Banka toplamına kilit (kalan farkı tek düzeltmeyle kapat) */}
            {statementTotal > 0 && (
              isFullyReconciled(statementTotal, appTotalAfter) ? (
                <p className="flex items-center justify-center gap-1.5 rounded-xl bg-success/10 p-3 text-sm font-bold text-success">
                  <CheckCircle2 size={15} />
                  {locked ? 'Banka toplamına kilitlendi (app = banka)' : 'Tam mutabık — app = banka'}
                </p>
              ) : (
                <div className="space-y-2 rounded-xl border border-border p-3 text-left">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">App</span>
                    <span className="font-black text-foreground">{formatAmount(appTotalAfter)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Banka</span>
                    <span className="font-black text-foreground">{formatAmount(statementTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="font-bold text-muted-foreground">Kalan fark</span>
                    <span className="font-black text-destructive">
                      {lockResidualTL >= 0 ? '+' : ''}{formatAmount(lockResidualTL)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Kilit, kalanı tek denetlenebilir düzeltmeyle banka toplamına çeker. Fark büyükse önce fazla/manuel kayıtları gözden geçir.
                  </p>
                  {lockError && (
                    <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive">
                      <AlertCircle size={13} className="shrink-0" />
                      {lockError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={locking}
                    onClick={() => void handleLock()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-black text-primary-foreground disabled:opacity-55"
                  >
                    {locking && <Loader2 size={13} className="animate-spin" />}
                    {locking ? 'Kilitleniyor…' : 'Banka toplamına kilitle'}
                  </button>
                </div>
              )
            )}

            <button
              type="button"
              onClick={onSuccess}
              className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
            >
              Tamam
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
