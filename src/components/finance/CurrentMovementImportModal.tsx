import { AlertCircle, Check, CheckCircle2, ChevronDown, FileUp, Loader2, Monitor, Scale, X, XCircle } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  addCardExpense,
  cancelCardExpense,
  fetchCardExpenseMatchRows,
  fetchCardPaymentMatchRows,
  insertGuardStatementArchive,
  payPaymentFromCardImport,
  resetCardData,
  type ExpenseMatchRow,
  type PaymentMatchRow,
} from '../../data/repositories/cardsRepo'
import { useAuth } from '../../auth/useAuth'
import { insertAccountReconciliation } from '../../data/repositories/financePanelsRepo'
import { extractPdfText } from '../../lib/pdfText'
import type { Card } from '../../types/database'
import {
  matchDenizBankMovements,
  matchDenizBankMovementPayments,
  parseDenizBankMovementPdf,
  type DenizBankMovementMatch,
  type DenizBankMovementPaymentMatch,
  type ParsedDenizBankMovement,
  type ParsedDenizBankPayment,
} from '../../utils/denizBankMovementParser'
import { formatCurrency } from '../../utils/formatCurrency'
import { dateRangeFromIsoDates, rowsInReviewPeriod } from '../../utils/importReviewPeriod'
import { roundTL, sumTL } from '../../utils/money'
import { getCardStatementPeriod } from '../../utils/cardStatement'
import { useBodyScrollLock } from '../ui/use-body-scroll-lock'

type Step = 'upload' | 'review' | 'done'

type ImportableMovement = {
  selectionKey: string
  movement: ParsedDenizBankMovement
  plannedPayment: PaymentMatchRow | null
}

type CancellableExpense = {
  selectionKey: string
  expense: ExpenseMatchRow
}

type Props = {
  card: Card
  onClose: () => void
  onSuccess: () => void
}

function formatShortDate(iso: string) {
  if (!iso) return '-'
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
}

function statusLabel(movement: ParsedDenizBankMovement) {
  return movement.appStatus === 'provision' ? 'Provizyon' : 'Dönem içi'
}

function statusClassName(movement: ParsedDenizBankMovement) {
  return movement.appStatus === 'provision'
    ? 'bg-warning/10 text-warning'
    : 'bg-success/10 text-success'
}

function appExpenseStatusLabel(status: string) {
  if (status === 'provision') return 'Provizyon'
  if (status === 'posted') return 'Dönem içi'
  if (status === 'cancelled') return 'İptal'
  return status
}

function isMobileDevice() {
  return window.innerWidth < 768
}


export function CurrentMovementImportModal({ card, onClose, onSuccess }: Props) {
  useBodyScrollLock(true)
  const { user } = useAuth()

  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')

  const [matched, setMatched] = useState<ParsedDenizBankMovement[]>([])
  const [matches, setMatches] = useState<DenizBankMovementMatch[]>([])
  const [showMatched, setShowMatched] = useState(false)
  const [plannedPaymentMatches, setPlannedPaymentMatches] = useState<DenizBankMovementPaymentMatch[]>([])

  const [bankOnly, setBankOnly] = useState<ImportableMovement[]>([])
  const [appOnly, setAppOnly] = useState<CancellableExpense[]>([])
  const [manualReview, setManualReview] = useState<ParsedDenizBankMovement[]>([])
  const [payments, setPayments] = useState<ParsedDenizBankPayment[]>([])
  const [ignoredCount, setIgnoredCount] = useState(0)
  const [periodLabel, setPeriodLabel] = useState('')

  const [cleanImport, setCleanImport] = useState(false)
  const [allMovements, setAllMovements] = useState<ParsedDenizBankMovement[]>([])
  const [installmentCounts, setInstallmentCounts] = useState<Map<number, number>>(new Map())

  const [selectedImport, setSelectedImport] = useState<Set<string>>(new Set())
  const [selectedCancel, setSelectedCancel] = useState<Set<string>>(new Set())
  const [resultMessage, setResultMessage] = useState('')

  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLocaleLowerCase('tr-TR').endsWith('.pdf')) {
      setParseError('Lütfen bir PDF dosyası seç.')
      return
    }

    setParsing(true)
    setParseError('')
    setApplyError('')

    try {
      const text = await extractPdfText(file)
      const parsed = parseDenizBankMovementPdf(text)
      if (!parsed.movements.length && !parsed.payments.length) {
        setParseError('DenizBank hareket tablosu okunamadı.')
        return
      }

      setAllMovements(parsed.movements)
      setPayments(parsed.payments)
      setIgnoredCount(parsed.ignoredRows.length)

      if (cleanImport) {
        setMatched([])
        setMatches([])
        setBankOnly([])
        setAppOnly([])
        setManualReview([])
        setPlannedPaymentMatches([])
        setPeriodLabel('')
        setStep('review')
        return
      }

      const [expensesResult, paymentsResult] = await Promise.all([
        fetchCardExpenseMatchRows(card.id),
        fetchCardPaymentMatchRows(card.id),
      ])
      if (!expensesResult.ok) {
        setParseError(expensesResult.error.message ?? 'Kart harcamaları yüklenemedi.')
        return
      }
      if (!paymentsResult.ok) {
        setParseError(paymentsResult.error.message ?? 'Planlı ödemeler yüklenemedi.')
        return
      }

      const fallbackPeriod = dateRangeFromIsoDates([
        ...parsed.movements.map((m) => m.date),
        ...parsed.payments.map((p) => p.date),
      ])
      const cardPeriod = getCardStatementPeriod(card, fallbackPeriod?.end ?? null)
      const reviewPeriod = cardPeriod
        ? { start: cardPeriod.periodStart, end: cardPeriod.periodEnd, label: cardPeriod.periodLabel }
        : fallbackPeriod

      const periodExpenses = rowsInReviewPeriod(expensesResult.data, reviewPeriod)

      const result = matchDenizBankMovements(parsed.movements, expensesResult.data, periodExpenses)

      const unmatchedNonInstallments = result.unmatched.filter((m) => !m.isInstallment)
      const paymentMatchResult = matchDenizBankMovementPayments(unmatchedNonInstallments, paymentsResult.data, card.id)
      const plannedPaymentByMovement = new Map<string, PaymentMatchRow>(
        paymentMatchResult.matches.map(({ movement, payment }) => [movement.rawLine, payment as PaymentMatchRow]),
      )

      const nextBankOnly = unmatchedNonInstallments.map((movement, index) => ({
        selectionKey: `bank-${index}:${movement.rawLine}`,
        movement,
        plannedPayment: plannedPaymentByMovement.get(movement.rawLine) ?? null,
      }))
      const nextManual = result.unmatched.filter((m) => m.isInstallment)
      const nextAppOnly = result.appOnly
        .filter((expense): expense is ExpenseMatchRow => 'id' in expense && typeof expense.id === 'string')
        .map((expense, index) => ({
          selectionKey: `app-${index}:${expense.id}`,
          expense,
        }))

      setMatched(result.matched)
      setMatches(result.matches)
      setShowMatched(false)
      setPlannedPaymentMatches(paymentMatchResult.matches)
      setPeriodLabel(reviewPeriod?.label ?? '')
      setBankOnly(nextBankOnly)
      setAppOnly(nextAppOnly)
      setManualReview(nextManual)
      setSelectedImport(new Set())
      setSelectedCancel(new Set())
      setStep('review')
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setParsing(false)
    }
  }, [card, cleanImport])

  function toggleImportAll() {
    if (selectedImport.size === bankOnly.length) setSelectedImport(new Set())
    else setSelectedImport(new Set(bankOnly.map((item) => item.selectionKey)))
  }

  function toggleImportRow(key: string) {
    setSelectedImport((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleCancelAll() {
    if (selectedCancel.size === appOnly.length) setSelectedCancel(new Set())
    else setSelectedCancel(new Set(appOnly.map((item) => item.selectionKey)))
  }

  function toggleCancelRow(key: string) {
    setSelectedCancel((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleCleanImport() {
    if (!allMovements.length) return

    setApplying(true)
    setApplyError('')

    const resetResult = await resetCardData(card.id)
    if (!resetResult.ok) {
      setApplyError(`Sıfırlama başarısız: ${resetResult.error.message ?? 'Bilinmeyen hata.'}`)
      setApplying(false)
      return
    }

    let successCount = 0
    const errors: string[] = []

    const today = new Date().toISOString().slice(0, 10)

    for (let i = 0; i < allMovements.length; i++) {
      const movement = allMovements[i]
      const totalCount = installmentCounts.get(i) ?? movement.installmentCount
      const knownPlan = movement.isInstallment && totalCount > 1
      const remaining = knownPlan ? Math.max(1, totalCount - movement.installmentNo + 1) : 1
      const result = await addCardExpense({
        cardId: card.id,
        amount: knownPlan ? roundTL(movement.amount * remaining) : movement.amount,
        description: movement.description,
        spentAt: knownPlan ? today : movement.date,
        installmentCount: knownPlan ? remaining : 1,
        category: movement.category,
        status: movement.appStatus,
      })
      if (!result.ok) errors.push(`${movement.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    if (!successCount) {
      setApplyError(`İçe aktarma başarısız: ${errors[0] ?? 'Bilinmeyen hata.'}`)
      setApplying(false)
      return
    }

    if (user) {
      // Guard archive: prevent cut_due_card_statements from auto-cutting
      if (card.card_type === 'kredi_karti' && card.statement_day) {
        const now = new Date()
        const y = now.getFullYear()
        const m = now.getMonth()
        const lastDay = new Date(y, m + 1, 0).getDate()
        const sd = Math.min(card.statement_day, lastDay)
        const boundary = new Date(y, m, sd)
        if (now > boundary) {
          const dateStr = boundary.toISOString().slice(0, 10)
          await insertGuardStatementArchive(user.id, card.id, y, m + 1, dateStr)
        } else {
          const prev = new Date(y, m - 1, 1)
          const prevLastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate()
          const prevSd = Math.min(card.statement_day, prevLastDay)
          const prevBoundary = new Date(prev.getFullYear(), prev.getMonth(), prevSd)
          const dateStr = prevBoundary.toISOString().slice(0, 10)
          await insertGuardStatementArchive(user.id, card.id, prev.getFullYear(), prev.getMonth() + 1, dateStr)
        }
      }

      const pdfTotal = sumTL(allMovements.map((m) => {
        const tc = installmentCounts.get(allMovements.indexOf(m)) ?? m.installmentCount
        const knownP = m.isInstallment && tc > 1
        const rem = knownP ? Math.max(1, tc - m.installmentNo + 1) : 1
        return knownP ? roundTL(m.amount * rem) : m.amount
      }))
      await insertAccountReconciliation({
        user_id: user.id,
        card_id: card.id,
        target: 'debt',
        app_amount: pdfTotal,
        real_amount: pdfTotal,
        drift: 0,
        reconciled_at: new Date().toISOString(),
      })
    }

    setResultMessage(`Kart sıfırlandı, ${successCount} hareket içe aktarıldı`)
    setApplying(false)
    setStep('done')
  }

  async function handleApply() {
    const toImport = bankOnly.filter((item) => selectedImport.has(item.selectionKey))
    const toCancel = appOnly.filter((item) => selectedCancel.has(item.selectionKey))
    if (!toImport.length && !toCancel.length) return

    setApplying(true)
    setApplyError('')

    let importedCount = 0
    let cancelledCount = 0
    const errors: string[] = []

    for (const item of toImport) {
      const { movement, plannedPayment } = item
      const result = plannedPayment
        ? await payPaymentFromCardImport({
          paymentId: plannedPayment.id,
          sourceCardId: card.id,
          amount: movement.amount,
          spentAt: movement.date,
        })
        : await addCardExpense({
          cardId: card.id,
          amount: movement.amount,
          description: movement.description,
          spentAt: movement.date,
          category: movement.category,
          installmentCount: 1,
          status: movement.appStatus,
        })
      if (!result.ok) errors.push(`${movement.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else importedCount++
    }

    for (const item of toCancel) {
      const result = await cancelCardExpense(item.expense.id)
      if (!result.ok) errors.push(`${item.expense.description ?? 'Harcama'} iptal: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else cancelledCount++
    }

    if (!importedCount && !cancelledCount) {
      setApplyError(`İşlem başarısız: ${errors[0] ?? 'Bilinmeyen hata.'}`)
      setApplying(false)
      return
    }

    const parts: string[] = []
    if (importedCount) parts.push(`${importedCount} hareket içe aktarıldı`)
    if (cancelledCount) parts.push(`${cancelledCount} harcama iptal edildi`)
    setResultMessage(parts.join(', '))
    setApplying(false)
    setStep('done')
  }

  const totalSelectedActions = selectedImport.size + selectedCancel.size
  const bankOnlyTotal = sumTL(bankOnly.map(({ movement }) => movement.amount))
  const appOnlyTotal = sumTL(appOnly.map(({ expense }) => expense.amount))

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-sm sm:items-center sm:p-6">
      <div className="max-h-[88svh] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-2xl bg-card shadow-xl sm:max-h-[92svh]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <Scale size={16} className="shrink-0 text-primary" />
            <span className="truncate text-sm font-black text-foreground">Hareket mutabakatı</span>
            <span className="hidden rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground sm:inline">
              {card.card_name}
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
          <div className="space-y-4 p-4">
            {isMobileDevice() ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/30 p-6 text-center">
                <Monitor size={32} className="text-muted-foreground" />
                <p className="text-sm font-bold text-foreground">Bu özellik masaüstü tarayıcıda kullanılabilir</p>
                <p className="text-xs text-muted-foreground">
                  PDF işleme altyapısı mobil tarayıcılarda desteklenmiyor. Lütfen bilgisayarından dene.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  DenizBank internet bankacılığından alınan kredi kartı hareket PDF&apos;ini seç.
                  {cleanImport
                    ? ' Kartın tüm verileri sıfırlanıp PDF\'ten yeniden kurulacak.'
                    : ' Banka hareketleri ile app kayıtları karşılaştırılacak.'}
                </p>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
                  <input
                    type="checkbox"
                    checked={cleanImport}
                    onChange={(e) => setCleanImport(e.target.checked)}
                    className="size-4 accent-warning"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-foreground">Sıfırlayıp PDF&apos;ten kur</p>
                    <p className="text-[11px] text-muted-foreground">
                      Kartın mevcut harcamaları silinir, PDF&apos;teki tüm hareketler baştan yüklenir.
                    </p>
                  </div>
                </label>

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
                    {parsing ? 'PDF okunuyor...' : 'PDF seç'}
                  </span>
                  <span className="text-xs text-muted-foreground">DenizBank İnternet Bankacılığı.pdf</span>
                </button>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void handleFile(file)
                  }}
                />
              </>
            )}

            {parseError && (
              <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle size={15} className="shrink-0" />
                {parseError}
              </p>
            )}
          </div>
        )}

        {/* Review step — clean import view */}
        {step === 'review' && cleanImport && (
          <div className="flex max-h-[76vh] flex-col">
            <div className="space-y-3 border-b border-border p-4">
              <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Kartın tüm harcamaları silinecek</p>
                  <p className="mt-0.5 text-xs text-warning/80">
                    Mevcut harcamalar, taksitler ve ekstre arşivleri kaldırılıp aşağıdaki {allMovements.length} hareket baştan yüklenecek.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {allMovements.map((movement, index) => {
                const userCount = installmentCounts.get(index)
                const effectiveCount = userCount ?? movement.installmentCount
                const remaining = effectiveCount > 1 ? Math.max(1, effectiveCount - movement.installmentNo + 1) : 1

                return (
                  <div
                    key={`clean-${movement.date}-${movement.amount}-${index}`}
                    className="border-b border-border/50 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-foreground">{movement.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatShortDate(movement.date)} · {movement.category}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-black text-foreground">{formatCurrency(movement.amount)}</span>
                    </div>

                    {movement.isInstallment && (
                      <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
                        <span className="text-[11px] text-muted-foreground">{movement.installmentNo}. taksit ·</span>
                        <label className="flex items-center gap-1 text-[11px] font-bold text-foreground">
                          Toplam
                          <input
                            type="number"
                            min={movement.installmentNo}
                            max={60}
                            placeholder="?"
                            value={userCount ?? ''}
                            onChange={(e) => {
                              const val = e.target.value ? Math.max(movement.installmentNo, Number(e.target.value)) : undefined
                              setInstallmentCounts((prev) => {
                                const next = new Map(prev)
                                if (val) next.set(index, val)
                                else next.delete(index)
                                return next
                              })
                            }}
                            className="w-12 rounded border border-border bg-background px-1.5 py-0.5 text-center text-[11px] font-bold text-foreground"
                          />
                          taksit
                        </label>
                        {effectiveCount > 1 && (
                          <span className="text-[11px] text-success">
                            → kalan {remaining}, toplam {formatCurrency(roundTL(movement.amount * remaining))}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {applyError && (
              <p className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle size={13} className="shrink-0" />
                {applyError}
              </p>
            )}

            <div className="border-t border-border p-4">
              <button
                type="button"
                disabled={applying || !allMovements.length}
                onClick={() => void handleCleanImport()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-warning py-3 text-sm font-black text-white disabled:opacity-55"
              >
                {applying && <Loader2 size={15} className="animate-spin" />}
                {applying ? 'Sıfırlanıyor...' : `Sıfırla ve ${allMovements.length} hareketi aktar`}
              </button>
            </div>
          </div>
        )}

        {/* Review step — conflict-resolution view */}
        {step === 'review' && !cleanImport && (
          <div className="flex max-h-[76vh] flex-col">
            {/* Summary */}
            <div className="space-y-3 border-b border-border p-4">
              <div className="grid grid-cols-2 gap-2 text-xs min-[560px]:grid-cols-4">
                <div className="rounded-lg bg-success/10 p-2.5">
                  <p className="font-bold text-success">Eşleşen</p>
                  <p className="mt-0.5 font-black text-foreground">{matched.length}</p>
                </div>
                <div className="rounded-lg bg-info/10 p-2.5">
                  <p className="font-bold text-info">Sadece bankada</p>
                  <p className="mt-0.5 font-black text-foreground">{bankOnly.length}</p>
                </div>
                <div className="rounded-lg bg-warning/10 p-2.5">
                  <p className="font-bold text-warning">Sadece app'te</p>
                  <p className="mt-0.5 font-black text-foreground">{appOnly.length}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Manuel</p>
                  <p className="mt-0.5 font-black text-foreground">{manualReview.length}</p>
                </div>
              </div>

              {periodLabel && (
                <p className="text-[11px] font-bold text-muted-foreground">Dönem: {periodLabel}</p>
              )}

              {payments.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-info/10 p-2.5 text-[11px] font-medium text-info">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {payments.length} ödeme satırı harcama olarak aktarılmadı.
                </p>
              )}

              {plannedPaymentMatches.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-success/10 p-2.5 text-[11px] font-medium text-success">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                  {plannedPaymentMatches.length} satır planlı ödeme ile eşleşti.
                </p>
              )}

              {ignoredCount > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-2.5 text-[11px] font-medium text-warning">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {ignoredCount} satır okunamadı.
                </p>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* ── Matched section (collapsible) ── */}
              {matches.length > 0 && (
                <div className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => setShowMatched((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/30"
                    aria-expanded={showMatched}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-success">Eşleşen kayıtlar ({matches.length})</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Banka hareketi ile app kaydı uyuşuyor — aksiyon gerekmez.
                      </span>
                    </span>
                    <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${showMatched ? 'rotate-180' : ''}`} />
                  </button>
                  {showMatched && (
                    <div className="max-h-60 overflow-y-auto">
                      {matches.map(({ movement, expense }, index) => (
                        <div
                          key={`match-${movement.date}-${movement.amount}-${index}`}
                          className="border-b border-border/50 px-4 py-2.5"
                        >
                          <div className="flex items-start gap-3">
                            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                            <div className="min-w-0 flex-1">
                              <div className="grid gap-1 min-[500px]:grid-cols-2">
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase text-info">Banka</p>
                                  <p className="truncate text-xs font-bold text-foreground">{movement.description}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {formatShortDate(movement.date)} · {formatCurrency(movement.amount)}
                                  </p>
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-bold uppercase text-primary">App</p>
                                  <p className="truncate text-xs font-bold text-foreground">{expense.description || 'Açıklama yok'}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {formatShortDate(expense.spent_at)} · {formatCurrency(expense.amount)} · {appExpenseStatusLabel(expense.status)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Bank only section (importable) ── */}
              {bankOnly.length > 0 && (
                <div className="border-b border-border">
                  <div className="flex items-center justify-between px-4 py-2">
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-info">Sadece bankada ({bankOnly.length})</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        PDF'te var ama app'te yok — seçtiklerini içe aktar. Toplam {formatCurrency(bankOnlyTotal)}
                      </span>
                    </div>
                    <button type="button" onClick={toggleImportAll} className="shrink-0 text-xs font-bold text-primary">
                      {selectedImport.size === bankOnly.length ? 'Kaldır' : 'Tümünü seç'}
                    </button>
                  </div>
                  {bankOnly.map((item) => {
                    const { movement, plannedPayment } = item
                    const isSelected = selectedImport.has(item.selectionKey)
                    return (
                      <button
                        type="button"
                        key={item.selectionKey}
                        onClick={() => toggleImportRow(item.selectionKey)}
                        aria-pressed={isSelected}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/30"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-4 shrink-0 place-items-center rounded border ${
                            isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'
                          }`}
                        >
                          {isSelected ? <Check size={12} strokeWidth={3} /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="grid gap-1 min-[500px]:grid-cols-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-info">Banka</p>
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <p className="min-w-0 truncate text-xs font-bold text-foreground">{movement.description}</p>
                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${statusClassName(movement)}`}>
                                  {statusLabel(movement)}
                                </span>
                                {plannedPayment && (
                                  <span className="rounded-md bg-info/10 px-1.5 py-0.5 text-[10px] font-black text-info">Planlı</span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {formatShortDate(movement.date)} · {movement.category}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-primary">App</p>
                              <p className="text-xs italic text-muted-foreground">Kayıt yok</p>
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 text-right text-xs font-black text-foreground">
                          {formatCurrency(movement.amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* ── App only section (cancellable) ── */}
              {appOnly.length > 0 && (
                <div className="border-b border-border">
                  <div className="flex items-center justify-between px-4 py-2">
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-warning">Sadece app'te ({appOnly.length})</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        App'te var ama bankada yok — çift sayılmış olabilir. Toplam {formatCurrency(appOnlyTotal)}
                      </span>
                    </div>
                    <button type="button" onClick={toggleCancelAll} className="shrink-0 text-xs font-bold text-warning">
                      {selectedCancel.size === appOnly.length ? 'Kaldır' : 'Tümünü seç'}
                    </button>
                  </div>
                  {appOnly.map((item) => {
                    const { expense } = item
                    const isSelected = selectedCancel.has(item.selectionKey)
                    return (
                      <button
                        type="button"
                        key={item.selectionKey}
                        onClick={() => toggleCancelRow(item.selectionKey)}
                        aria-pressed={isSelected}
                        className="flex w-full cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left hover:bg-muted/30"
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-4 shrink-0 place-items-center rounded border ${
                            isSelected ? 'border-warning bg-warning text-white' : 'border-border bg-background'
                          }`}
                        >
                          {isSelected ? <XCircle size={12} strokeWidth={3} /> : null}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="grid gap-1 min-[500px]:grid-cols-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-info">Banka</p>
                              <p className="text-xs italic text-muted-foreground">Kayıt yok</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase text-primary">App</p>
                              <p className="min-w-0 truncate text-xs font-bold text-foreground">{expense.description || 'Açıklama yok'}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatShortDate(expense.spent_at)} · {expense.category || ''} · {appExpenseStatusLabel(expense.status)}
                              </p>
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 text-right text-xs font-black text-foreground">
                          {formatCurrency(expense.amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* ── Manual review (installments) ── */}
              {manualReview.length > 0 && (
                <div className="border-b border-border">
                  <div className="px-4 py-2">
                    <span className="text-xs font-bold text-muted-foreground">Manuel kontrol gerekli ({manualReview.length})</span>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Taksitli satırlar otomatik aktarılmadı.
                    </p>
                  </div>
                  <div className="max-h-44 overflow-y-auto">
                    {manualReview.map((movement, index) => (
                      <div
                        key={`manual-${movement.date}-${movement.description}-${index}`}
                        className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-foreground">{movement.description}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatShortDate(movement.date)} · {movement.detail || 'Taksitli işlem'} · **** {movement.cardLastFour}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-black text-foreground">{formatCurrency(movement.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All reconciled */}
              {bankOnly.length === 0 && appOnly.length === 0 && manualReview.length === 0 && (
                <div className="p-6 text-center">
                  <CheckCircle2 size={32} className="mx-auto text-success" />
                  <p className="mt-2 text-sm font-bold text-foreground">Tüm hareketler eşleşiyor</p>
                  <p className="mt-1 text-xs text-muted-foreground">Mutabakat tamam.</p>
                </div>
              )}
            </div>

            {/* Action bar */}
            {applyError && (
              <p className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle size={13} className="shrink-0" />
                {applyError}
              </p>
            )}

            <div className="border-t border-border p-4">
              {totalSelectedActions > 0 ? (
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => void handleApply()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-55"
                >
                  {applying && <Loader2 size={15} className="animate-spin" />}
                  {applying ? 'Uygulanıyor...' : (
                    <>
                      {selectedImport.size > 0 && `${selectedImport.size} içe aktar`}
                      {selectedImport.size > 0 && selectedCancel.size > 0 && ' · '}
                      {selectedCancel.size > 0 && `${selectedCancel.size} iptal et`}
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-black text-primary-foreground"
                >
                  Kapat
                </button>
              )}
            </div>
          </div>
        )}

        {/* Done step */}
        {step === 'done' && (
          <div className="space-y-3 p-6 text-center">
            <CheckCircle2 size={40} className="mx-auto text-success" />
            <p className="text-base font-black text-foreground">{resultMessage}</p>
            <p className="text-sm text-muted-foreground">Kart bakiyesi güncellendi.</p>
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
