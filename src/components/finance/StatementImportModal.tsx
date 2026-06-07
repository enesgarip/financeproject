import { FileUp, X, CheckCircle2, AlertCircle, Loader2, FileText } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Card } from '../../types/database'
import { formatCurrency } from '../../utils/formatCurrency'
import { parseDenizBankStatement, matchTransactions, expenseTotalAmount, type ParsedTransaction } from '../../utils/denizBankStatementParser'

/**
 * App'e güvenle otomatik aktarılabilen işlem mi?
 * - Peşin/tek çekim → her zaman aktarılabilir (tek harcama).
 * - Yeni taksitli (1. taksit, toplam taksit sayısı biliniyor) → tam plan kurulabilir.
 * - Plan-ortası taksit (no>1) veya toplam sayısı bilinmeyen → otomatik kurmak
 *   geçmişi çift sayar; bunlar manuel kontrole bırakılır.
 */
function isImportable(tx: ParsedTransaction): boolean {
  if (!tx.isInstallment) return true
  return tx.installmentNo === 1 && tx.installmentCount > 1
}

// ── PDF text extraction (lazy-loads pdfjs-dist) ───────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pageTexts: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (content.items as any[]).filter(
      (i) => typeof i.str === 'string' && Array.isArray(i.transform),
    ) as Array<{ str: string; transform: number[] }>

    // Sort: Y descending (PDF origin is bottom-left), then X ascending
    items.sort((a, b) => {
      const dy = b.transform[5] - a.transform[5]
      if (Math.abs(dy) > 3) return dy
      return a.transform[4] - b.transform[4]
    })

    // Group into rows by Y proximity
    const rows: string[][] = []
    let currentRow: string[] = []
    let lastY: number | null = null
    for (const item of items) {
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (currentRow.length) rows.push(currentRow)
        currentRow = []
      }
      if (item.str.trim()) currentRow.push(item.str.trim())
      lastY = y
    }
    if (currentRow.length) rows.push(currentRow)

    pageTexts.push(rows.map((r) => r.join(' ')).join('\n'))
  }

  return pageTexts.join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────

type Step = 'upload' | 'review' | 'success'

type Props = {
  card: Card
  onClose: () => void
  onSuccess: () => void
}

export function StatementImportModal({ card, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const [statementTotal, setStatementTotal] = useState(0)
  const [statementDate, setStatementDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [matched, setMatched] = useState<ParsedTransaction[]>([])
  const [unmatched, setUnmatched] = useState<ParsedTransaction[]>([])
  const [manualReview, setManualReview] = useState<ParsedTransaction[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
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
      const parsed = parseDenizBankStatement(text)

      if (!parsed.totalDebt && !parsed.transactions.length) {
        setParseError('PDF okunamadı veya Denizbank ekstre formatında değil.')
        setParsing(false)
        return
      }

      // Load existing expenses for this card to match against
      const { data: expenses } = await supabase
        .from('card_expenses')
        .select('spent_at, amount, status')
        .eq('card_id', card.id)

      const result = matchTransactions(parsed.transactions, expenses ?? [])

      // App'te olmayan işlemleri ikiye ayır: otomatik aktarılabilir olanlar ve
      // plan-ortası/eksik bilgili taksitler (manuel kontrol gerektirir).
      const importable = result.unmatched.filter(isImportable)
      const manual = result.unmatched.filter((tx) => !isImportable(tx))

      setStatementTotal(parsed.totalDebt)
      setStatementDate(parsed.statementDate)
      setDueDate(parsed.dueDate)
      setMatched(result.matched)
      setUnmatched(importable)
      setManualReview(manual)
      setSelected(new Set(importable.map((_, i) => i)))
      setStep('review')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'PDF işlenirken bir hata oluştu.')
    } finally {
      setParsing(false)
    }
  }, [card.id])

  async function handleImport() {
    const toImport = unmatched.filter((_, i) => selected.has(i))
    if (!toImport.length) return

    setImporting(true)
    setImportError('')

    let successCount = 0
    const errors: string[] = []

    for (const tx of toImport) {
      const installment = tx.isInstallment && tx.installmentCount > 1
      const { error } = await supabase.rpc('add_card_expense', {
        p_card_id: card.id,
        // Taksitli işlemde ekstre aylık tutarı taşır; harcamayı TOPLAM tutarla aç.
        p_amount: installment ? expenseTotalAmount(tx) : tx.amount,
        p_description: tx.description,
        p_spent_at: tx.date,
        p_installment_count: installment ? tx.installmentCount : 1,
        p_category: tx.category,
        p_status: 'posted' as const,
      })
      if (error) errors.push(`${tx.description}: ${error.message}`)
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

    // Dönem, ekstrenin kesim tarihinden türetilir (arşiv anahtarıyla aynı mantık).
    const period = statementDate ? new Date(`${statementDate}T00:00:00`) : new Date()
    const { error } = await supabase.rpc('set_statement_reconciliation', {
      p_card_id: card.id,
      p_period_year: period.getFullYear(),
      p_period_month: period.getMonth() + 1,
      p_bank_amount: statementTotal,
      p_note: null,
    })

    if (error) setReconcileError(error.message)
    else setReconciled(true)
    setReconciling(false)
  }

  function toggleAll() {
    if (selected.size === unmatched.length) setSelected(new Set())
    else setSelected(new Set(unmatched.map((_, i) => i)))
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  function formatShortDate(iso: string) {
    if (!iso) return '-'
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00`))
  }

  const appCardDebt = card.statement_debt_amount + card.current_period_spending
  const diff = statementTotal - appCardDebt

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl bg-card shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
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
              Denizbank'tan aldığın ekstre PDF'ini yükle. Tüm işlemler cihazında okunur, dışarıya çıkmaz.
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground">App hesabı</span>
                  <span className="font-black text-foreground">{formatCurrency(appCardDebt)}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex justify-between">
                  <span className="font-bold text-muted-foreground">Fark</span>
                  <span className={`font-black ${Math.abs(diff) < 1 ? 'text-success' : 'text-destructive'}`}>
                    {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                  </span>
                </div>
              </div>

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

              {reconcileError && (
                <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive">
                  <AlertCircle size={13} className="shrink-0" />
                  {reconcileError}
                </p>
              )}

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 font-bold text-success">
                  <CheckCircle2 size={12} />
                  {matched.length} eşleşti
                </span>
                <span className="flex items-center gap-1 rounded-md bg-warning/10 px-2 py-1 font-bold text-warning">
                  <AlertCircle size={12} />
                  {unmatched.length} eksik
                </span>
                {manualReview.length > 0 && (
                  <span className="flex items-center gap-1 rounded-md bg-info/10 px-2 py-1 font-bold text-info">
                    <AlertCircle size={12} />
                    {manualReview.length} manuel
                  </span>
                )}
              </div>
            </div>

            {/* Importable (otomatik aktarılabilir) işlemler */}
            {unmatched.length > 0 && (
              <>
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <span className="text-xs font-bold text-muted-foreground">App'te olmayan işlemler</span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-bold text-primary"
                  >
                    {selected.size === unmatched.length ? 'Tümünü kaldır' : 'Tümünü seç'}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {unmatched.map((tx, i) => (
                    <label
                      key={i}
                      className="flex cursor-pointer items-center gap-3 border-b border-border/50 px-4 py-2.5 hover:bg-muted/30"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggleRow(i)}
                        className="size-4 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-foreground">{tx.description}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatShortDate(tx.date)} · {tx.category}
                          {tx.isInstallment ? ` · ${tx.installmentCount} taksit` : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-xs font-black text-foreground">
                        {formatCurrency(tx.isInstallment ? expenseTotalAmount(tx) : tx.amount)}
                        {tx.isInstallment && (
                          <span className="block text-[10px] font-bold text-muted-foreground">
                            {formatCurrency(tx.amount)}/ay
                          </span>
                        )}
                      </span>
                    </label>
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
    </div>
  )
}
