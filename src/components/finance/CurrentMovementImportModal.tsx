import { AlertCircle, CheckCircle2, ChevronDown, FileUp, Loader2, Scale, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addCardExpense, fetchCardExpenseMatchRows, type ExpenseMatchRow } from '../../data/repositories/cardsRepo'
import { extractPdfText } from '../../lib/pdfText'
import type { Card } from '../../types/database'
import {
  matchDenizBankMovements,
  parseDenizBankMovementPdf,
  type DenizBankMovementMatch,
  type ParsedDenizBankMovement,
  type ParsedDenizBankPayment,
} from '../../utils/denizBankMovementParser'
import { formatCurrency } from '../../utils/formatCurrency'
import { dateRangeFromIsoDates, rowsInReviewPeriod } from '../../utils/importReviewPeriod'
import { sumTL } from '../../utils/money'
import { getCardStatementPeriod } from '../../utils/cardStatement'
import { CardExpenseHistorySection } from './CardExpenseHistorySection'
import { useBodyScrollLock } from '../ui/use-body-scroll-lock'

type Step = 'upload' | 'review' | 'success'

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

export function CurrentMovementImportModal({ card, onClose, onSuccess }: Props) {
  useBodyScrollLock(true)

  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [matched, setMatched] = useState<ParsedDenizBankMovement[]>([])
  const [matches, setMatches] = useState<DenizBankMovementMatch[]>([])
  const [showMatches, setShowMatches] = useState(false)
  const [periodExpenses, setPeriodExpenses] = useState<ExpenseMatchRow[]>([])
  const [periodLabel, setPeriodLabel] = useState('')
  const [importable, setImportable] = useState<ParsedDenizBankMovement[]>([])
  const [manualReview, setManualReview] = useState<ParsedDenizBankMovement[]>([])
  const [payments, setPayments] = useState<ParsedDenizBankPayment[]>([])
  const [ignoredCount, setIgnoredCount] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importedCount, setImportedCount] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLocaleLowerCase('tr-TR').endsWith('.pdf')) {
      setParseError('Lütfen bir PDF dosyası seç.')
      return
    }

    setParsing(true)
    setParseError('')
    setImportError('')

    try {
      const text = await extractPdfText(file)
      const parsed = parseDenizBankMovementPdf(text)
      if (!parsed.movements.length && !parsed.payments.length) {
        setParseError('DenizBank hareket tablosu okunamadı.')
        return
      }

      const expensesResult = await fetchCardExpenseMatchRows(card.id)
      if (!expensesResult.ok) {
        setParseError(expensesResult.error.message ?? 'Kart harcamaları yüklenemedi.')
        return
      }

      const result = matchDenizBankMovements(parsed.movements, expensesResult.data)
      const fallbackPeriod = dateRangeFromIsoDates([...parsed.movements.map((movement) => movement.date), ...parsed.payments.map((payment) => payment.date)])
      const cardPeriod = getCardStatementPeriod(card, fallbackPeriod?.end ?? null)
      const reviewPeriod = cardPeriod
        ? { start: cardPeriod.periodStart, end: cardPeriod.periodEnd, label: cardPeriod.periodLabel }
        : fallbackPeriod
      const nextImportable = result.unmatched.filter((movement) => !movement.isInstallment)
      const nextManual = result.unmatched.filter((movement) => movement.isInstallment)

      setMatched(result.matched)
      setMatches(result.matches)
      setShowMatches(false)
      setPeriodLabel(reviewPeriod?.label ?? '')
      setPeriodExpenses(rowsInReviewPeriod(expensesResult.data, reviewPeriod))
      setImportable(nextImportable)
      setManualReview(nextManual)
      setPayments(parsed.payments)
      setIgnoredCount(parsed.ignoredRows.length)
      setSelected(new Set())
      setStep('review')
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setParsing(false)
    }
  }, [card])

  function toggleAll() {
    if (selected.size === importable.length) setSelected(new Set())
    else setSelected(new Set(importable.map((_, index) => index)))
  }

  function toggleRow(index: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleImport() {
    const toImport = importable.filter((_, index) => selected.has(index))
    if (!toImport.length) return

    setImporting(true)
    setImportError('')

    let successCount = 0
    const errors: string[] = []

    for (const movement of toImport) {
      const result = await addCardExpense({
        cardId: card.id,
        amount: movement.amount,
        description: movement.description,
        spentAt: movement.date,
        category: movement.category,
        installmentCount: 1,
        status: movement.appStatus,
      })

      if (!result.ok) errors.push(`${movement.description}: ${result.error.message ?? 'Bilinmeyen hata.'}`)
      else successCount++
    }

    setImportedCount(successCount)
    setImporting(false)

    if (!successCount) {
      setImportError(`İçe aktarma başarısız: ${errors[0] ?? 'Bilinmeyen hata.'}`)
      return
    }

    setStep('success')
  }

  const importableTotal = sumTL(importable.map((movement) => movement.amount))
  const selectedTotal = sumTL(importable.filter((_, index) => selected.has(index)).map((movement) => movement.amount))
  const manualTotal = sumTL(manualReview.map((movement) => movement.amount))

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-sm sm:items-center sm:p-6">
      <div className="max-h-[88svh] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-2xl bg-card shadow-xl sm:max-h-[92svh]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <Scale size={16} className="shrink-0 text-primary" />
            <span className="truncate text-sm font-black text-foreground">Güncel hareket mutabakatı</span>
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

        {step === 'upload' && (
          <div className="space-y-4 p-4">
            <p className="text-sm text-muted-foreground">
              DenizBank internet bankacılığından alınan kredi kartı hareket PDF'ini seç.
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

            {parseError && (
              <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle size={15} className="shrink-0" />
                {parseError}
              </p>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="flex max-h-[76vh] flex-col">
            <div className="space-y-3 border-b border-border p-4">
              <div className="grid grid-cols-2 gap-2 text-xs min-[560px]:grid-cols-4">
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Eşleşen</p>
                  <p className="mt-0.5 font-black text-foreground">{matched.length}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Aktarılacak</p>
                  <p className="mt-0.5 font-black text-foreground">{importable.length}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Manuel</p>
                  <p className="mt-0.5 font-black text-foreground">{manualReview.length}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-2.5">
                  <p className="font-bold text-muted-foreground">Ödeme</p>
                  <p className="mt-0.5 font-black text-foreground">{payments.length}</p>
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 p-3 text-xs">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Seçili tutar</span>
                  <span className="font-black text-foreground">{formatCurrency(selectedTotal)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-muted-foreground">Aktarılabilir toplam</span>
                  <span className="font-black text-foreground">{formatCurrency(importableTotal)}</span>
                </div>
                {manualReview.length > 0 ? (
                  <div className="mt-1 flex justify-between gap-3">
                    <span className="text-muted-foreground">Manuel kontrol tutarı</span>
                    <span className="font-black text-foreground">{formatCurrency(manualTotal)}</span>
                  </div>
                ) : null}
              </div>

              {payments.length > 0 ? (
                <p className="flex items-start gap-2 rounded-lg bg-info/10 p-2.5 text-[11px] font-medium text-info">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {payments.length} ödeme satırı harcama olarak aktarılmadı.
                </p>
              ) : null}

              {ignoredCount > 0 ? (
                <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-2.5 text-[11px] font-medium text-warning">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  {ignoredCount} satır okunamadı; dosya formatı değişmiş olabilir.
                </p>
              ) : null}
            </div>

            <CardExpenseHistorySection expenses={periodExpenses} periodLabel={periodLabel} />

            {matches.length > 0 && (
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
                      {matches.length} kayıt gizli. Banka hareketi ile app'teki kaydı birlikte görmek için aç.
                    </span>
                  </span>
                  <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${showMatches ? 'rotate-180' : ''}`} />
                </button>
                {showMatches ? (
                  <div className="max-h-48 overflow-y-auto">
                    {matches.map(({ movement, expense }, index) => (
                      <div
                        key={`${movement.date}-${movement.description}-${movement.amount}-${index}`}
                        className="border-b border-border/50 px-4 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="min-w-0 truncate text-xs font-bold text-foreground">{movement.description}</p>
                              <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${statusClassName(movement)}`}>
                                {statusLabel(movement)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Banka: {formatShortDate(movement.date)} · **** {movement.cardLastFour}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              App: {expense.description || 'Açıklama yok'} · {formatShortDate(expense.spent_at)} · {appExpenseStatusLabel(expense.status)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs font-black text-foreground">{formatCurrency(movement.amount)}</p>
                            <p className="text-[10px] font-bold text-muted-foreground">App {formatCurrency(expense.amount)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}

            {importable.length > 0 && (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">App'te olmayan hareketler</span>
                  <button type="button" onClick={toggleAll} className="text-xs font-bold text-primary">
                    {selected.size === importable.length ? 'Tümünü kaldır' : 'Tümünü seç'}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {importable.map((movement, index) => (
                    <div
                      key={`${movement.date}-${movement.description}-${movement.amount}-${index}`}
                      onClick={() => toggleRow(index)}
                      className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2.5 hover:bg-muted/30"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(index)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleRow(index)}
                        className="size-4 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="min-w-0 truncate text-xs font-bold text-foreground">{movement.description}</p>
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${statusClassName(movement)}`}>
                            {statusLabel(movement)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {formatShortDate(movement.date)} · {movement.category} · **** {movement.cardLastFour}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-xs font-black text-foreground">
                        {formatCurrency(movement.amount)}
                      </span>
                    </div>
                  ))}
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
                    {importing ? 'İçe aktarılıyor...' : `${selected.size} hareketi içe aktar`}
                  </button>
                </div>
              </>
            )}

            {manualReview.length > 0 && (
              <div className="border-t border-border">
                <div className="px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">Manuel kontrol gerekli</span>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Taksitli satırlar otomatik aktarılmadı.
                  </p>
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {manualReview.map((movement, index) => (
                    <div
                      key={`${movement.date}-${movement.description}-${index}`}
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

            {importable.length === 0 && manualReview.length === 0 && (
              <div className="p-6 text-center">
                <CheckCircle2 size={32} className="mx-auto text-success" />
                <p className="mt-2 text-sm font-bold text-foreground">PDF'teki harcamalar app'te kayıtlı</p>
                <p className="mt-1 text-xs text-muted-foreground">Mutabakat tamam.</p>
              </div>
            )}

            {importable.length === 0 && (
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

        {step === 'success' && (
          <div className="space-y-3 p-6 text-center">
            <CheckCircle2 size={40} className="mx-auto text-success" />
            <p className="text-base font-black text-foreground">{importedCount} hareket içe aktarıldı</p>
            <p className="text-sm text-muted-foreground">Kart hareketleri güncellendi.</p>
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
