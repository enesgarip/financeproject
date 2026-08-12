import { FileUp, X, CheckCircle2, AlertCircle, Loader2, FileText, ChevronDown } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../ui/use-body-scroll-lock'
import { useDialogA11y } from '../ui/use-dialog-a11y'
import { useCategoryMemory } from '../../hooks/useCategoryMemory'
import {
  fetchCardExpenseMatchRows,
  fetchCardPaymentMatchRows,
  replaceCardStatementImport,
  type CardStatementReplaceAction,
  type ExpenseMatchRow,
  type PaymentMatchRow,
} from '../../data/repositories/cardsRepo'
import { useBalancePrivacy } from '../../hooks/useBalancePrivacy'
import type { Card } from '../../types/database'
import { getCardStatementPeriod } from '../../utils/cardStatement'
import { dateRangeFromIsoDates, rowsInReviewPeriod } from '../../utils/importReviewPeriod'
import {
  parseDenizBankStatement,
  checkStatementParseTotals,
  type ParsedStatement,
  type ParsedTransaction,
  type ParsedStatementAdjustment,
} from '../../utils/denizBankStatementParser'
import { matchDenizBankMovementPayments, type ParsedDenizBankMovement } from '../../utils/denizBankMovementParser'
import { parseYapiKrediStatement } from '../../utils/yapiKrediStatementParser'
import { resolveStatementImportAction, type StatementImportAction } from '../../utils/statementImportPlan'
import { roundTL } from '../../utils/money'
import { checkInstallmentNotation } from '../../utils/importedInstallmentPlan'
import { parseStatementText } from '../../lib/statementParseClient'
import { extractPdfText } from '../../lib/pdfText'
import { CardExpenseHistorySection } from './CardExpenseHistorySection'
import { importedRowEventIds, sha256Hex } from '../../utils/sourceEventId'

/**
 * App'e güvenle otomatik aktarılabilen işlem mi?
 * - Peşin/tek çekim → her zaman aktarılabilir.
 * - Taksitli (toplam sayı biliniyor) → aktarılabilir. 1. taksit tam plan kurar;
 *   plan-ortası (no>1) carryover RPC ile yalnız cari ve gelecek açık planı kurar;
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

/**
 * PDF'in kendi özet toplamları okunan satırlarla tutmuyorsa engellemeyen bir
 * uyarı metni üretir (yoksa null). İki bağımsız kimlik: başlık öz-tutarlılığı ve
 * satır toplamı (bkz. checkStatementParseTotals). Satır uyuşmazlığı en kritik:
 * parser bir satırı düşürmüş olabilir → kategori/taksit sessizce eksik kalır.
 */
function buildParseTotalsWarning(parsed: ParsedStatement): string | null {
  const totals = checkStatementParseTotals(parsed)
  if (totals.lines.checked && !totals.lines.consistent) {
    const diff = roundTL(Math.abs(totals.lines.residualTL))
    return `Ekstredeki işlem satırları özet tutarı ${diff} TL tutmuyor — PDF'ten bir satır eksik/yanlış okunmuş olabilir. İçe aktarabilirsin ama listeyi dikkatle kontrol et.`
  }
  if (totals.header.checked && !totals.header.consistent) {
    const diff = roundTL(Math.abs(totals.header.residualTL))
    return `Ekstre başlık toplamları ${diff} TL tutarsız — PDF eksik/bozuk okunmuş olabilir. Dikkatle incele.`
  }
  return null
}

// ── Component ─────────────────────────────────────────────────────────────

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
 * Plancının (resolveStatementImportAction) verdiği aksiyonu atomik yeniden
 * kurulum (replaceCardStatementImport) aksiyonuna çevirir. needs-review satırı
 * güvenle yazılamaz → null döner, çağıran manuel doğrulamaya düşürür.
 */
function toReplaceAction(
  action: StatementImportAction,
  row: Pick<StatementImportRow, 'transaction' | 'sourceEventId'>,
): CardStatementReplaceAction | null {
  const common = {
    description: row.transaction.description,
    category: row.transaction.category,
    sourceEventId: row.sourceEventId,
  }
  switch (action.kind) {
    case 'payment':
      return { ...action, sourceEventId: row.sourceEventId }
    case 'expense':
      return { ...action, ...common }
    case 'carryover':
      return { ...action, ...common }
    case 'needs-review':
      return null
  }
}

export function StatementImportModal({ card, onClose, onSuccess }: Props) {
  const { formatAmount } = useBalancePrivacy()
  // Modal açıkken arka plan sayfasının kaymasını engelle (ortak kilit kalıbı).
  useBodyScrollLock(true)

  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const [statementTotal, setStatementTotal] = useState(0)
  const [statementDate, setStatementDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [periodExpenses, setPeriodExpenses] = useState<ExpenseMatchRow[]>([])
  const [periodLabel, setPeriodLabel] = useState('')
  const [importRows, setImportRows] = useState<StatementImportRow[]>([])
  const [adjustments, setAdjustments] = useState<StatementAdjustmentRow[]>([])
  const [manualReview, setManualReview] = useState<ManualReviewRow[]>([])

  // Parse doğrulama uyarısı (PDF'in kendi özet toplamları okunan satırlarla
  // tutmuyorsa; engellemez, dikkat çeker). Bkz. checkStatementParseTotals.
  const [parseTotalsWarning, setParseTotalsWarning] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState(0)

  // Manuel taksitlere inline "elle ekle" (toplam adet girilince importable).
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({})
  const [manualAddedKeys, setManualAddedKeys] = useState<Set<string>>(new Set())
  const [manualError, setManualError] = useState('')

  const [showAppExpenses, setShowAppExpenses] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  // Geçmiş harcamalardan öğrenilen kategori hafızası: import önerileri de
  // kullanıcının düzeltmelerinden faydalansın (yalnız keyword sözlüğü değil).
  const categoryMemory = useCategoryMemory()

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
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
      setParseTotalsWarning(buildParseTotalsWarning(parsed))

      // Load existing app expenses once: the period history panel shares the
      // same snapshot as the import review.
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

      const importable = parsed.transactions.filter(isImportable)
      const manual: ManualReviewRow[] = parsed.transactions
        .filter((tx) => !isImportable(tx))
        .map((transaction, index) => ({
          key: `manual:${index}:${transaction.date}:${transaction.amount}:${transaction.description}`,
          transaction,
          sourceEventId: sourceEventIds.get(transaction)!,
        }))

      setImportRows(attachPlannedPayments(importable, paymentsResult.data, card.id, sourceEventIds))
      setAdjustments(attachStatementAdjustments(parsed.adjustments ?? []))
      setManualReview(manual)
      setStep('review')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setParsing(false)
    }
  }, [card, categoryMemory])

  async function handleImport() {
    if (!importRows.length && manualAddedKeys.size === 0 && adjustments.length === 0) return

    if (!statementDate) {
      setImportError('Ekstre kesim tarihi okunamadı; yeniden kurulum başlatılmadı.')
      return
    }

    if (manualAddedKeys.size !== manualReview.length) {
      setImportError('PDF kaynak gerçek olarak uygulanmadan önce tüm manuel taksitleri doğrula.')
      return
    }

    setImporting(true)
    setImportError('')

    const actions: CardStatementReplaceAction[] = []
    for (const item of importRows) {
      const { transaction: tx, plannedPayment } = item
      const action = resolveStatementImportAction({ transaction: tx, plannedPaymentId: plannedPayment?.id })
      const replacement = toReplaceAction(action, item)
      if (!replacement) {
        setImportError(`${tx.description}: taksit bilgisi doğrulanmadan yeniden kurulum yapılamaz.`)
        setImporting(false)
        return
      }
      actions.push(replacement)
    }

    for (const row of manualReview) {
      const totalInstallments = Number(manualDrafts[row.key] ?? '')
      const action = resolveStatementImportAction({
        transaction: row.transaction,
        totalInstallmentsOverride: totalInstallments,
      })
      const replacement = toReplaceAction(action, {
        transaction: row.transaction,
        sourceEventId: row.sourceEventId,
      })
      if (!replacement) {
        setImportError(`${row.transaction.description}: manuel taksit doğrulaması geçersiz.`)
        setImporting(false)
        return
      }
      actions.push(replacement)
    }

    for (const item of adjustments) {
      actions.push({
        kind: 'adjustment',
        amount: item.adjustment.amount,
        description: item.adjustment.description,
        spentAt: item.adjustment.date,
        sourceEventId: item.selectionKey,
      })
    }

    const result = await replaceCardStatementImport({
      cardId: card.id,
      statementDate,
      dueDate: dueDate || null,
      bankAmount: statementTotal,
      actions,
    })
    if (!result.ok) {
      setImportError(result.error.message ?? 'Ekstre yeniden kurulamadı.')
      setImporting(false)
      return
    }

    setImportedCount(actions.length)
    setImporting(false)
    setStep('success')
  }

  function handleAddManual(row: ManualReviewRow) {
    const totalInstallments = Number(manualDrafts[row.key] ?? '')
    if (!Number.isInteger(totalInstallments) || totalInstallments < Math.max(1, row.transaction.installmentNo)) {
      setManualError(`Toplam taksit sayısı en az ${Math.max(1, row.transaction.installmentNo)} olmalı.`)
      return
    }

    setManualError('')
    setManualAddedKeys((prev) => new Set(prev).add(row.key))
  }

  function formatShortDate(iso: string) {
    if (!iso) return '-'
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
  }

  const importableCount = importRows.length + adjustments.length
  const unresolvedManualCount = manualReview.length - manualAddedKeys.size

  // Escape yalnız işlem sürmüyorken kapatır: içe aktarma yarısında kaçmak
  // kısmi kayıt bırakabilir.
  const dialogRef = useDialogA11y<HTMLDivElement>(true, () => {
    if (!importing && !parsing) onClose()
  })

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-[var(--overlay)] px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-sm sm:items-center sm:p-6">
      {/* Bu modal SimpleModal'a sarılamıyor (kendi sticky başlığı + tam genişlik
          adım gövdeleri var), o yüzden diyalog sözleşmesi elle kuruluyor: aynı
          `useDialogA11y` hook'u, `role="dialog"` + `aria-modal` + `aria-labelledby`.
          Eskiden ham div'di — trap/Escape/rol yoktu (denetim 2026-08-12 §6). */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="statement-import-title"
        className="max-h-[88svh] w-full max-w-lg overflow-x-hidden overflow-y-auto rounded-2xl bg-card focus:outline-none sm:max-h-[92svh]"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" aria-hidden="true" />
            <span id="statement-import-title" className="text-sm font-black text-foreground">Ekstre İçe Aktar</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
              **** {card.card_name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="tap-target grid size-7 place-items-center rounded-lg hover:bg-muted"
          >
            <X size={15} aria-hidden="true" />
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
              PDF açık ekstre döneminin kaynak gerçeğidir. Ödenmiş geçmiş ve ekstre tarihinden sonraki hareketler korunarak dönem atomik biçimde yeniden kurulur.
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
            <p className="flex items-start gap-2 border-b border-border bg-warning/10 px-4 py-3 text-xs font-bold text-warning">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              Ekstre tarihine kadarki açık harcama ve taksitler PDF satırlarıyla yeniden kurulacak. Ödenmiş geçmiş ve daha sonraki hareketler korunur; işlem yarıda kalırsa hiçbir değişiklik uygulanmaz.
            </p>
            {parseTotalsWarning && (
              <p className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-3 text-xs font-bold text-destructive">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {parseTotalsWarning}
              </p>
            )}

            {/* ── Kompakt özet ── */}
            <div className="border-b border-border p-4 space-y-2">
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
              <div className="rounded-xl bg-muted/40 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bankadan gelen</span>
                  <span className="font-black text-foreground">{formatAmount(statementTotal)}</span>
                </div>
              </div>
            </div>

            {/* ═══ AKSİYONLAR ═══ */}

            <div className="flex-1 overflow-y-auto">

              {/* ── A1: İçe aktarılacak ekstre satırları (ANA AKSİYON) ── */}
              {importableCount > 0 && (
                <div className="border-b border-border">
                  <div className="px-4 py-2">
                    <span className="text-xs font-bold text-foreground">
                      İçe aktarılacak ekstre satırları ({importableCount})
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto">
                    {importRows.map((item) => {
                      const { transaction: tx, plannedPayment } = item
                      const knownPlan = tx.isInstallment && tx.installmentCount > 1
                      const isLastInstallment = knownPlan && tx.installmentNo === tx.installmentCount
                      const planCount = knownPlan
                        ? Math.max(1, tx.installmentCount - tx.installmentNo + 1)
                        : tx.installmentCount
                      const rowTotal = knownPlan && !isLastInstallment
                        ? roundTL(tx.amount * planCount)
                        : tx.amount
                      return (
                        <div
                          key={item.selectionKey}
                          data-testid="statement-import-row"
                          className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left"
                        >
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
                                  : knownPlan ? `${tx.installmentNo}/${tx.installmentCount}. taksit, ${planCount} kalan`
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
                        </div>
                      )
                    })}
                    {adjustments.map((item) => {
                      const { adjustment } = item
                      return (
                        <div
                          key={item.selectionKey}
                          data-testid="statement-import-adjustment-row"
                          className="flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left"
                        >
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
                        </div>
                      )
                    })}
                  </div>

                  {importError && (
                    <p className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                      <AlertCircle size={13} className="shrink-0" />
                      {importError}
                    </p>
                  )}
                </div>
              )}

              {/* ── A3: Manuel kontrol ── */}
              {manualReview.length > 0 && (
                <div className="border-b border-border">
                  <div className="px-4 py-2">
                    <span className="text-xs font-bold text-muted-foreground">Manuel kontrol ({manualReview.length})</span>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Toplam taksiti belirsiz. Sayısını gir, buradan ekle.
                    </p>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {manualReview.map((row) => {
                      const tx = row.transaction
                      const added = manualAddedKeys.has(row.key)
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
                              <CheckCircle2 size={12} /> Doğrulandı
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
                                onClick={() => handleAddManual(row)}
                                className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-black text-primary-foreground disabled:opacity-55"
                              >
                                Doğrula
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

              {/* ── B2: App dönem harcamaları (katlanır referans) ── */}
              {periodExpenses.length > 0 && (
                <div className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => setShowAppExpenses((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/30"
                    aria-expanded={showAppExpenses}
                  >
                    <span className="text-xs font-bold text-muted-foreground">
                      App dönem harcamaları ({periodExpenses.length})
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${showAppExpenses ? 'rotate-180' : ''}`} />
                  </button>
                  {showAppExpenses && <CardExpenseHistorySection expenses={periodExpenses} periodLabel={periodLabel} />}
                </div>
              )}

              {/* Hiç eksik yok */}
              {importableCount === 0 && manualReview.length === 0 && (
                <div className="p-6 text-center">
                  <CheckCircle2 size={32} className="mx-auto text-success" />
                  <p className="mt-2 text-sm font-bold text-foreground">Tüm işlemler app'te zaten kayıtlı</p>
                  <p className="mt-1 text-xs text-muted-foreground">Mutabakat tamam.</p>
                </div>
              )}
            </div>

            {/* ── Sticky CTA bar ── */}
            {(importableCount > 0 || manualReview.length > 0) && (
              <div className="sticky bottom-0 z-10 border-t border-border bg-card p-4">
                <button
                  type="button"
                  disabled={(importableCount === 0 && manualAddedKeys.size === 0) || unresolvedManualCount > 0 || importing}
                  onClick={() => void handleImport()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-55"
                >
                  {importing && <Loader2 size={15} className="animate-spin" />}
                  {importing
                    ? 'İçe aktarılıyor…'
                    : unresolvedManualCount > 0
                      ? `Önce ${unresolvedManualCount} taksiti doğrula`
                      : `${importableCount + manualAddedKeys.size} satırla yeniden kur`}
                </button>
              </div>
            )}

            {/* İçe aktarılacak bir şey yokken kapat butonu */}
            {importableCount === 0 && manualReview.length === 0 && (
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

            {statementTotal > 0 && (
              <p className="flex items-center justify-center gap-1.5 rounded-xl bg-success/10 p-3 text-sm font-bold text-success">
                <CheckCircle2 size={15} />
                Kart borcu banka toplamına ({formatAmount(statementTotal)}) ayarlandı
              </p>
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
