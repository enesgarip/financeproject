import { FileUp, X, Check, CheckCircle2, AlertCircle, Loader2, FileText, ChevronDown } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../ui/use-body-scroll-lock'
import {
  addCardExpense,
  cutCardStatement,
  fetchCardExpenseMatchRows,
  fetchCardPaymentMatchRows,
  payPaymentFromCardImport,
  recordCardInstallmentCarryover,
  resetCardData,
  setStatementReconciliation,
  type ExpenseMatchRow,
  type PaymentMatchRow,
} from '../../data/repositories/cardsRepo'
import type { Card } from '../../types/database'
import { getCardStatementPeriod } from '../../utils/cardStatement'
import { formatCurrency } from '../../utils/formatCurrency'
import { dateRangeFromIsoDates, rowsInReviewPeriod } from '../../utils/importReviewPeriod'
import {
  parseDenizBankStatement,
  matchTransactions,
  expenseTotalAmount,
  type ParsedTransaction,
  type StatementTransactionMatch,
} from '../../utils/denizBankStatementParser'
import { matchDenizBankMovementPayments, type ParsedDenizBankMovement } from '../../utils/denizBankMovementParser'
import { diffTL, equalsTL, roundTL, sumTL } from '../../utils/money'
import { addMonthsToMonth, monthInputValue } from '../../pages/CardsPage.helpers'
import { parseStatementText } from '../../lib/statementParseClient'
import { extractPdfText } from '../../lib/pdfText'
import { CardExpenseHistorySection } from './CardExpenseHistorySection'

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
  return tx.installmentCount > 1
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
  transaction: ParsedTransaction
  plannedPayment: PaymentMatchRow | null
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
    transaction,
    plannedPayment: paymentByIndex.get(index) ?? null,
  }))
}

export function StatementImportModal({ card, onClose, onSuccess }: Props) {
  // Modal açıkken arka plan sayfasının kaymasını engelle (ortak kilit kalıbı).
  useBodyScrollLock(true)

  const [step, setStep] = useState<Step>('upload')
  const [cleanImport, setCleanImport] = useState(false)
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
  const [manualReview, setManualReview] = useState<ParsedTransaction[]>([])
  const [plannedPaymentMatches, setPlannedPaymentMatches] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importedCount, setImportedCount] = useState(0)

  const [reconciling, setReconciling] = useState(false)
  const [reconciled, setReconciled] = useState(false)
  const [reconcileError, setReconcileError] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.pdf')) {
      setParseError('Lütfen bir PDF dosyası seçin.')
      return
    }

    setParsing(true)
    setParseError('')

    try {
      const text = await extractPdfText(file)
      let parsed = parseDenizBankStatement(text)

      // DenizBank formatı tanınmadıysa banka-bağımsız çözümleyiciye düş (Y3):
      // metin parse-statement edge fonksiyonuna (Gemini) gönderilir.
      if (!parsed.totalDebt && !parsed.transactions.length) {
        parsed = await parseStatementText(text)
      }

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
      const [expensesResult, paymentsResult] = await Promise.all([
        fetchCardExpenseMatchRows(card.id),
        fetchCardPaymentMatchRows(card.id),
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

      // Temiz içe aktarma: kart sıfırlanacağı için eşleştirme yapılmaz; tüm
      // işlemler (peşin + taksit) baştan kurulur.
      if (cleanImport) {
        const importRows = attachPlannedPayments(parsed.transactions, paymentsResult.data, card.id)
        setMatched([])
        setMatches([])
        setShowMatches(false)
        setManualReview([])
        setUnmatched(importRows)
        setPlannedPaymentMatches(importRows.filter(({ plannedPayment }) => plannedPayment).length)
        setSelected(new Set())
        setStep('review')
        return
      }

      const result = matchTransactions(parsed.transactions, expenses)

      // App'te olmayan işlemleri ikiye ayır: otomatik aktarılabilir olanlar ve
      // plan-ortası/eksik bilgili taksitler (manuel kontrol gerektirir).
      const importable = result.unmatched.filter(isImportable)
      const manual = result.unmatched.filter((tx) => !isImportable(tx))
      const importRows = attachPlannedPayments(importable, paymentsResult.data, card.id)

      setMatched(result.matched)
      setMatches(result.matches)
      setShowMatches(false)
      setUnmatched(importRows)
      setManualReview(manual)
      setPlannedPaymentMatches(importRows.filter(({ plannedPayment }) => plannedPayment).length)
      setSelected(new Set())
      setStep('review')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setParsing(false)
    }
  }, [card, cleanImport])

  function todayIso() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  // Mutabakat dönemi: temiz içe aktarmada ekstre bugün kesildiği için bugünün
  // dönemi; normal modda ekstre kesim tarihinin dönemi kullanılır.
  function reconcilePeriodDate() {
    if (cleanImport) return new Date()
    return statementDate ? new Date(`${statementDate}T00:00:00`) : new Date()
  }

  async function handleCleanImport() {
    const toImport = unmatched.filter((item) => selected.has(item.selectionKey))
    if (!toImport.length) return

    setImporting(true)
    setImportError('')

    // 1) Kartı baseline'a çek.
    const resetResult = await resetCardData(card.id)
    if (!resetResult.ok) {
      setImportError(`Sıfırlama başarısız: ${resetResult.error.message ?? 'Bilinmeyen hata.'}`)
      setImporting(false)
      return
    }

    // 2) Tüm işlemleri baştan kur (peşin + kalan-plan taksitler).
    const today = todayIso()
    let successCount = 0
    const errors: string[] = []

    for (const item of toImport) {
      const { transaction: tx, plannedPayment } = item
      const knownPlan = tx.isInstallment && tx.installmentCount > 1
      // Plan-ortası taksitte kalan adet bu aydan itibaren kurulur.
      const remaining = knownPlan ? Math.max(1, tx.installmentCount - tx.installmentNo + 1) : 1
      const result = plannedPayment
        ? await payPaymentFromCardImport({
          paymentId: plannedPayment.id,
          sourceCardId: card.id,
          amount: tx.amount,
          spentAt: tx.date,
        })
        : await addCardExpense({
        cardId: card.id,
        amount: knownPlan ? roundTL(tx.amount * remaining) : tx.amount,
        description: tx.description,
        // Kalan plan kuruluyorsa bugünden başlat; peşin/tek çekim orijinal tarihte kalır.
        spentAt: knownPlan ? today : tx.date,
        installmentCount: knownPlan ? remaining : 1,
        category: tx.category,
        status: 'posted',
      })
      if (!result.ok) errors.push(`${tx.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    setImportedCount(successCount)

    if (!successCount) {
      setImportError(`İçe aktarma başarısız: ${errors[0] ?? 'Bilinmeyen hata.'}`)
      setImporting(false)
      return
    }

    // 3) Ekstreyi kes → dönem içi tutar açık ekstreye (statement_debt_amount) taşınır.
    const cutResult = await cutCardStatement(card.id)
    if (!cutResult.ok) {
      setImportError(`Ekstre kesilemedi: ${cutResult.error.message ?? 'Bilinmeyen hata.'}`)
      setImporting(false)
      return
    }

    // 4) Banka tutarıyla mutabık işaretle (bugünün dönemi).
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
    if (!toImport.length) return

    setImporting(true)
    setImportError('')

    let successCount = 0
    const errors: string[] = []

    for (const item of toImport) {
      const { transaction: tx, plannedPayment } = item
      const installment = tx.isInstallment && tx.installmentCount > 1
      const isMidPlan = installment && tx.installmentNo > 1 && tx.installmentNo < tx.installmentCount
      const isLastInstallment = installment && tx.installmentNo === tx.installmentCount
      let result
      if (plannedPayment) {
        result = await payPaymentFromCardImport({
          paymentId: plannedPayment.id,
          sourceCardId: card.id,
          amount: tx.amount,
          spentAt: tx.date,
        })
      } else if (isMidPlan) {
        result = await recordCardInstallmentCarryover({
          cardId: card.id,
          description: tx.description,
          installmentAmount: tx.amount,
          totalInstallments: tx.installmentCount,
          paidInstallments: tx.installmentNo,
          nextDueMonth: addMonthsToMonth(monthInputValue(), 1),
          category: tx.category,
        })
      } else {
        result = await addCardExpense({
          cardId: card.id,
          amount: installment && !isLastInstallment ? expenseTotalAmount(tx) : tx.amount,
          description: tx.description,
          spentAt: tx.date,
          installmentCount: installment && !isLastInstallment ? tx.installmentCount : 1,
          category: tx.category,
          status: 'posted',
        })
      }
      if (!result.ok) errors.push(`${tx.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    setImportedCount(successCount)

    if (errors.length && !successCount) {
      setImportError(`İçe aktarma başarısız: ${errors[0]}`)
      setImporting(false)
      return
    }

    setImporting(false)
    setStep('success')
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
    if (selected.size === unmatched.length) setSelected(new Set())
    else setSelected(new Set(unmatched.map((item) => item.selectionKey)))
  }

  function toggleRow(selectionKey: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(selectionKey)) next.delete(selectionKey)
      else next.add(selectionKey)
      return next
    })
  }

  function formatShortDate(iso: string) {
    if (!iso) return '-'
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
  }

  const appCardDebt = sumTL([card.statement_debt_amount, card.current_period_spending])
  const diff = diffTL(statementTotal, appCardDebt)

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
              Kredi kartı ekstre PDF'ini yükle. DenizBank ekstreleri tamamen cihazında okunur;
              diğer bankalarda metin yalnız çözümleme için sunucuya gönderilir, saklanmaz.
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

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-muted/30 p-3">
              <input
                type="checkbox"
                checked={cleanImport}
                onChange={(e) => setCleanImport(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-xs">
                <span className="block font-bold text-foreground">Bu kartı sıfırlayıp ekstreyi baştan kur</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Kartın mevcut tüm harcama, taksit ve ekstre verisi silinir; ekstredeki işlemler açık ekstre
                  olarak kurulur, plan-ortası taksitler kalan adetle bu aydan itibaren takip edilir.
                </span>
              </span>
            </label>

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
                Onayladığında bu kartın mevcut tüm harcama, taksit ve ekstre verisi silinip aşağıdaki işlemlerle baştan kurulur.
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
                  <span className="font-black text-foreground">{formatCurrency(statementTotal)}</span>
                </div>
                {!cleanImport && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">App hesabı</span>
                      <span className="font-black text-foreground">{formatCurrency(appCardDebt)}</span>
                    </div>
                    <div className="h-px bg-border" />
                    <div className="flex justify-between">
                      <span className="font-bold text-muted-foreground">Fark</span>
                      <span className={`font-black ${equalsTL(statementTotal, appCardDebt) ? 'text-success' : 'text-destructive'}`}>
                        {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
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
                              <p className="text-xs font-black text-foreground">{formatCurrency(bankTotal)}</p>
                              <p className="text-[10px] font-bold text-muted-foreground">App {formatCurrency(expense.amount)}</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )}

            {/* Importable (otomatik aktarılabilir) işlemler */}
            {unmatched.length > 0 && (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">{cleanImport ? 'İçe aktarılacak işlemler' : "App'te olmayan işlemler"}</span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-bold text-primary"
                  >
                    {selected.size === unmatched.length ? 'Tümünü kaldır' : 'Tümünü seç'}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {unmatched.map((item) => {
                    const { transaction: tx, plannedPayment } = item
                    const knownPlan = tx.isInstallment && tx.installmentCount > 1
                    const isMidPlan = knownPlan && tx.installmentNo > 1 && tx.installmentNo < tx.installmentCount
                    const isLastInstallment = knownPlan && tx.installmentNo === tx.installmentCount
                    // Clean modda veya plan-ortası devride kalan adet hesaplanır.
                    const remainingCount = Math.max(1, tx.installmentCount - tx.installmentNo)
                    const planCount = (cleanImport || isMidPlan) && knownPlan
                      ? (cleanImport ? Math.max(1, tx.installmentCount - tx.installmentNo + 1) : remainingCount)
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
                          {formatCurrency(rowTotal)}
                          {tx.isInstallment && (
                            <span className="block text-[10px] font-bold text-muted-foreground">
                              {formatCurrency(tx.amount)}/ay
                            </span>
                          )}
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
                      : `${selected.size} işlemi içe aktar`}
                  </button>
                </div>
              </>
            )}

            {/* Manuel kontrol gereken taksitler (plan-ortası / toplam taksiti belirsiz) */}
            {manualReview.length > 0 && (
              <div className="border-t border-border">
                <div className="px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">Manuel kontrol gerekli</span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Plan-ortası ya da toplam taksiti belirsiz işlemler otomatik aktarılmaz; gerekiyorsa Kartlar ekranından elle gir.
                  </p>
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {manualReview.map((tx, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
                    >
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
                        {formatCurrency(tx.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hiç eksik yok */}
            {unmatched.length === 0 && manualReview.length === 0 && (
              <div className="p-6 text-center">
                <CheckCircle2 size={32} className="mx-auto text-success" />
                <p className="mt-2 text-sm font-bold text-foreground">Tüm işlemler app'te zaten kayıtlı</p>
                <p className="mt-1 text-xs text-muted-foreground">Mutabakat tamam.</p>
              </div>
            )}

            {/* İçe aktarılacak bir şey yokken kapat butonu */}
            {unmatched.length === 0 && (
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
            <CheckCircle2 size={40} className="mx-auto text-success" />
            <p className="text-base font-black text-foreground">
              {importedCount} işlem içe aktarıldı
            </p>
            <p className="text-sm text-muted-foreground">
              Kart bakiyesi güncellendi.
            </p>
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
