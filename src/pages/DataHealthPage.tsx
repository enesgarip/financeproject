import { Activity, CheckCircle2, DatabaseZap, Download, RefreshCw, ShieldCheck, Undo2, Upload, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { LiveReconciliationPanel } from '../components/finance/LiveReconciliationPanel'
import { NotificationSettings } from '../components/finance/NotificationSettings'
import {
  buildBackupPayload,
  downloadBackupFile,
  parseBackup,
  restoreBackup,
  type ParsedBackup,
} from '../utils/backup'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  deleteDataHealthRows,
  fetchDataHealthRows,
  insertCardInstallments,
  resetUserFinanceData,
  updateDataHealthRow,
  updateDataHealthRows,
} from '../data/repositories/dataHealthRepo'
import type {
  InsertFor,
  UpdateFor,
} from '../types/database'
import { recomputeAccountBalance } from '../services/accountLedgerActions'
import { recomputeCardDebt } from '../services/cardLedgerActions'
import { roundMoney } from '../utils/financeSummary'
import {
  addMonthsToMonthStart,
  applyUndoEntry,
  buildIssues,
  captureUndoRows,
  currentMonthStart,
  downloadDataCsv,
  emptyData,
  isSchemaCacheError,
  makeUndoBatch,
  type HealthData,
  type HealthIssue,
  type UndoBatch,
  type UndoEntry,
  type UndoTable,
} from './DataHealth.logic'
import {
  FixAllModal,
  HealthIssueCard,
  HealthStat,
  ResetDataModal,
  RestoreBackupModal,
} from './DataHealthPage.components'

export function DataHealthPage() {
  const { user } = useAuth()
  const [data, setData] = useState<HealthData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<UndoBatch[]>([])
  const [undoing, setUndoing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetting, setResetting] = useState(false)
  const [snoozedIssueIds, setSnoozedIssueIds] = useState<string[]>([])
  const [fixAllOpen, setFixAllOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [restoreParsed, setRestoreParsed] = useState<ParsedBackup | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreStep, setRestoreStep] = useState('')
  const restoreFileRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    setMessage('')

    const result = await fetchDataHealthRows()
    if (!result.ok) {
      setError(result.error.message ?? 'Veri sağlığı kayıtları yüklenemedi.')
    } else {
      setData(result.data)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  const issues = useMemo(() => buildIssues(data), [data])
  const visibleIssues = useMemo(() => issues.filter((issue) => !snoozedIssueIds.includes(issue.id)), [issues, snoozedIssueIds])
  const fixableIssues = visibleIssues.filter((issue) => issue.fixable)
  const stats = {
    errors: visibleIssues.filter((issue) => issue.severity === 'error').length,
    warnings: visibleIssues.filter((issue) => issue.severity === 'warning').length,
    info: visibleIssues.filter((issue) => issue.severity === 'info').length,
  }

  async function fixIssue(issue: HealthIssue): Promise<UndoBatch | null> {
    const payload = issue.payload
    if (!payload) return null
    const undoEntries: UndoEntry[] = []
    const addUndo = async (table: UndoTable, ids: string[]) => {
      const entry = await captureUndoRows(table, ids)
      if (entry) undoEntries.push(entry)
    }

    if (issue.kind === 'assetShape' && payload.assetId && payload.updates) {
      await addUndo('assets', [payload.assetId])
      const updateError = await updateDataHealthRow('assets', payload.assetId, payload.updates as UpdateFor<'assets'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Varlık güncellenemedi.')
    }

    if (issue.kind === 'budgetMonth' && payload.budgetId && payload.updates) {
      await addUndo('budgets', [payload.budgetId])
      const updateError = await updateDataHealthRow('budgets', payload.budgetId, payload.updates as UpdateFor<'budgets'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Bütçe güncellenemedi.')
    }

    if (issue.kind === 'cardDebtSplit' && payload.cardId) {
      await addUndo('cards', [payload.cardId])
      const updateError = await updateDataHealthRow('cards', payload.cardId, {
          statement_debt_amount: payload.statementDebt ?? 0,
          current_period_spending: payload.currentPeriod ?? 0,
          provision_amount: payload.provisionAmount ?? 0,
        })
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart borç kırılımı güncellenemedi.')
    }

    if (issue.kind === 'cardScheduledDebt' && payload.cardId && payload.nextDebtAmount !== undefined) {
      await addUndo('cards', [payload.cardId])
      const updateError = await updateDataHealthRow('cards', payload.cardId, {
          debt_amount: payload.nextDebtAmount,
        })
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart borcu güncellenemedi.')
    }

    if (issue.kind === 'cardLedgerDrift' && payload.cardId) {
      await addUndo('cards', [payload.cardId])
      // Must go through the RPC, not a direct update: it suppresses the ledger
      // trigger so resetting debt to the projection doesn't emit a delta event.
      const { error: rpcError } = await recomputeCardDebt(payload.cardId)
      if (rpcError) throw new Error(rpcError.message ?? 'Borç yeniden hesaplanamadı.')
    }

    if (issue.kind === 'accountLedgerDrift' && payload.cardId) {
      await addUndo('cards', [payload.cardId])
      // RPC suppresses the balance trigger so resetting to the projection emits
      // no delta event.
      const { error: rpcError } = await recomputeAccountBalance(payload.cardId)
      if (rpcError) throw new Error(rpcError.message ?? 'Bakiye yeniden hesaplanamadı.')
    }

    if (issue.kind === 'cardTypeFields' && payload.cardId && payload.updates) {
      await addUndo('cards', [payload.cardId])
      const updateError = await updateDataHealthRow('cards', payload.cardId, payload.updates as UpdateFor<'cards'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart alanları güncellenemedi.')
    }

    if (issue.kind === 'cardExpenseAmount' && payload.expenseId && payload.updates) {
      await addUndo('card_expenses', [payload.expenseId])
      const updateError = await updateDataHealthRow('card_expenses', payload.expenseId, payload.updates as UpdateFor<'card_expenses'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart harcaması güncellenemedi.')
    }

    if (issue.kind === 'cardSingleInstallments' && payload.ids?.length) {
      await addUndo('card_installments', payload.ids)
      const deleteError = await deleteDataHealthRows('card_installments', payload.ids)
      if (!deleteError.ok) throw new Error(deleteError.error.message ?? 'Kart taksitleri silinemedi.')
    }

    if ((issue.kind === 'cardInstallmentDueMonth' || issue.kind === 'cardInstallmentPostedAt' || issue.kind === 'cardInstallmentCount') && payload.ids?.length && payload.updates) {
      await addUndo('card_installments', payload.ids)
      const updateError = await updateDataHealthRows('card_installments', payload.ids, payload.updates as UpdateFor<'card_installments'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kart taksitleri güncellenemedi.')
    }

    if (issue.kind === 'cardStatementTotals' && payload.statementArchiveId && payload.updates) {
      await addUndo('card_statement_archives', [payload.statementArchiveId])
      const updateError = await updateDataHealthRow(
        'card_statement_archives',
        payload.statementArchiveId,
        payload.updates as UpdateFor<'card_statement_archives'>,
      )
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Ekstre arşivi güncellenemedi.')
    }

    if (issue.kind === 'cardMissingInstallments' && payload.userId && payload.cardId && payload.cardExpenseId && payload.installmentNos && payload.baseMonth) {
      const rows: InsertFor<'card_installments'>[] = payload.installmentNos.map((installmentNo) => {
        const dueMonth = addMonthsToMonthStart(payload.baseMonth ?? currentMonthStart(), installmentNo - 1)
        const baseAmount = payload.amount ?? 0
        const installmentCount = payload.installmentCount ?? 1
        const amount =
          payload.totalAmount && installmentNo === installmentCount
            ? roundMoney(payload.totalAmount - baseAmount * (installmentCount - 1))
            : baseAmount

        return {
          user_id: payload.userId ?? '',
          card_id: payload.cardId ?? '',
          card_expense_id: payload.cardExpenseId ?? null,
          installment_no: installmentNo,
          installment_count: installmentCount,
          due_month: dueMonth,
          amount,
          description: payload.description ?? 'Taksit',
          category: payload.category ?? 'Diğer',
          status: 'scheduled',
          posted_at: null,
          paid_at: null,
          note: 'Veri sağlığı kontrolüyle tamamlandı.',
        }
      })

      const insertResult = await insertCardInstallments(rows)
      if (!insertResult.ok) throw new Error(insertResult.error.message ?? 'Eksik taksitler eklenemedi.')

      const insertedIds = insertResult.data
      if (insertedIds.length > 0) {
        undoEntries.push({ action: 'deleteRows', table: 'card_installments', ids: insertedIds })
      }
    }

    if (issue.kind === 'debtShape' && payload.debtId && payload.updates) {
      await addUndo('debts', [payload.debtId])
      const updateError = await updateDataHealthRow('debts', payload.debtId, payload.updates as UpdateFor<'debts'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Borç/alacak kaydı güncellenemedi.')
    }

    if (issue.kind === 'loanTotals' && payload.loanId) {
      await addUndo('loans', [payload.loanId])
      const updateError = await updateDataHealthRow('loans', payload.loanId, {
          remaining_amount: payload.remainingAmount ?? 0,
          remaining_installments: payload.remainingInstallments ?? 0,
          status: payload.loanStatus ?? 'active',
        })
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi özeti güncellenemedi.')
    }

    if (issue.kind === 'loanInstallmentDueDay' && payload.ids?.length && payload.updates) {
      await addUndo('loan_installments', payload.ids)
      const updateError = await updateDataHealthRows('loan_installments', payload.ids, payload.updates as UpdateFor<'loan_installments'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi taksitleri güncellenemedi.')
    }

    if (issue.kind === 'loanPaidAtMissing' && payload.ids?.length) {
      await addUndo('loan_installments', payload.ids)
      const updateError = await updateDataHealthRows('loan_installments', payload.ids, { paid_at: new Date().toISOString() })
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi taksitleri güncellenemedi.')
    }

    if (issue.kind === 'loanPendingPaidAt' && payload.ids?.length) {
      await addUndo('loan_installments', payload.ids)
      const updateError = await updateDataHealthRows('loan_installments', payload.ids, { paid_at: null })
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Kredi taksitleri güncellenemedi.')
    }

    if (issue.kind === 'paymentDueDay' && payload.paymentId && payload.dueDate) {
      await addUndo('payments', [payload.paymentId])
      const updateError = await updateDataHealthRow('payments', payload.paymentId, { due_date: payload.dueDate })
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Ödeme tarihi güncellenemedi.')
    }

    if (issue.kind === 'paymentRecurrenceFields' && payload.paymentId && payload.updates) {
      await addUndo('payments', [payload.paymentId])
      const updateError = await updateDataHealthRow('payments', payload.paymentId, payload.updates as UpdateFor<'payments'>)
      if (!updateError.ok) throw new Error(updateError.error.message ?? 'Planlı ödeme güncellenemedi.')
    }

    return makeUndoBatch(issue.title, undoEntries)
  }

  async function handleFix(issue: HealthIssue) {
    setFixingId(issue.id)
    setError('')
    setMessage('')

    try {
      const undoBatch = await fixIssue(issue)
      if (undoBatch) {
        setUndoStack((current) => [undoBatch, ...current].slice(0, 5))
      }
      await loadData()
      setMessage('Düzeltme uygulandı. Bu oturumda geri alabilirsin.')
    } catch (fixError) {
      setError(fixError instanceof Error ? fixError.message : 'Düzeltme uygulanamadı.')
    } finally {
      setFixingId(null)
    }
  }

  async function handleFixAll() {
    setFixAllOpen(false)
    setFixingId('all')
    setError('')
    setMessage('')
    const undoEntries: UndoEntry[] = []

    try {
      for (const issue of fixableIssues) {
        const undoBatch = await fixIssue(issue)
        if (undoBatch) undoEntries.push(...undoBatch.entries)
      }
      const batch = makeUndoBatch('Toplu veri sağlığı düzeltmesi', undoEntries)
      if (batch) {
        setUndoStack((current) => [batch, ...current].slice(0, 5))
      }
      await loadData()
      setMessage(`${fixableIssues.length} güvenli düzeltme uygulandı. Toplu işlem geri alınabilir.`)
    } catch (fixError) {
      const partialBatch = makeUndoBatch('Kısmi veri sağlığı düzeltmesi', undoEntries)
      if (partialBatch) {
        setUndoStack((current) => [partialBatch, ...current].slice(0, 5))
      }
      await loadData()
      setError(
        fixError instanceof Error
          ? `${fixError.message} Önceki başarılı adımlar geri alınabilir.`
          : 'Toplu düzeltme tamamlanamadı. Önceki başarılı adımlar geri alınabilir.',
      )
    } finally {
      setFixingId(null)
    }
  }

  async function handleUndo(batch: UndoBatch) {
    setUndoing(true)
    setError('')
    setMessage('')

    try {
      for (const entry of [...batch.entries].reverse()) {
        await applyUndoEntry(entry)
      }
      setUndoStack((current) => current.filter((item) => item.id !== batch.id))
      await loadData()
      setMessage('Son veri sağlığı düzeltmesi geri alındı.')
    } catch (undoError) {
      await loadData()
      setError(undoError instanceof Error ? undoError.message : 'Geri alma tamamlanamadı.')
    } finally {
      setUndoing(false)
    }
  }

  async function handleResetAllData(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedConfirm = resetConfirm.trim().toLocaleUpperCase('tr-TR')
    if (normalizedConfirm !== 'SİL' && normalizedConfirm !== 'SIL') {
      setError('Tüm veriyi silmek için onay alanına SİL yazmalısın.')
      return
    }

    setResetting(true)
    setError('')
    setMessage('')

    const resetError = await resetUserFinanceData()
    if (!resetError.ok) {
      setError(
        isSchemaCacheError(resetError.error)
          ? 'Sıfırlama altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
          : resetError.error.message ?? 'Tüm veri silinemedi.',
      )
      setResetting(false)
      return
    }

    setUndoStack([])
    setData(emptyData)
    setResetConfirm('')
    setResetOpen(false)
    setResetting(false)
    await loadData()
    setMessage('Tüm finans verisi silindi. Sıfırdan veri girebilirsin.')
  }

  async function handleFullExport() {
    setExporting(true)
    setError('')
    try {
      const { payload, totalRows } = await buildBackupPayload()
      downloadBackupFile(payload)
      setMessage(`Tam yedek indirildi (${totalRows} kayıt).`)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Yedek alınamadı.')
    } finally {
      setExporting(false)
    }
  }

  function handleRestoreFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    void file.text().then(
      (text) => {
        try {
          setRestoreConfirm('')
          setRestoreParsed(parseBackup(text))
        } catch (parseError) {
          setError(parseError instanceof Error ? parseError.message : 'Yedek dosyası okunamadı.')
        }
      },
      () => setError('Dosya okunamadı.'),
    )
  }

  async function handleRestore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!restoreParsed || !user) return
    const normalizedConfirm = restoreConfirm.trim().toLocaleUpperCase('tr-TR')
    if (normalizedConfirm !== 'YÜKLE' && normalizedConfirm !== 'YUKLE') {
      setError('Geri yüklemek için onay alanına YÜKLE yazmalısın.')
      return
    }

    setRestoring(true)
    setError('')
    setMessage('')

    try {
      // Safety net: download the current data before wiping anything.
      setRestoreStep('Mevcut veri yedekleniyor')
      const { payload } = await buildBackupPayload()
      downloadBackupFile(payload, 'financeproject-restore-oncesi')

      await restoreBackup(restoreParsed, user.id, (progress) => setRestoreStep(progress.step))

      setUndoStack([])
      setRestoreParsed(null)
      setRestoreConfirm('')
      await loadData()
      setMessage(`Yedek geri yüklendi (${restoreParsed.totalRows} kayıt).`)
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? `${restoreError.message} — İşlem yarıda kaldıysa az önce inen "restore-oncesi" dosyasıyla tekrar geri yükleyebilirsin.`
          : 'Geri yükleme başarısız.',
      )
    } finally {
      setRestoring(false)
      setRestoreStep('')
    }
  }

  return (
    <>
    <section className="space-y-4">
      <SurfaceCard variant="elevated" className="overflow-hidden">
        <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-info via-primary to-success opacity-80" />
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck size={20} className="text-primary" />
                Veri kontrolü
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Varlık, kart, kredi, kişi ve planlı ödeme kayıtları.</p>
            </div>
            <Badge variant={visibleIssues.length > 0 ? 'warning' : 'success'}>{loading ? 'Kontrol' : `${visibleIssues.length} bulgu`}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <HealthStat label="Kritik" value={stats.errors} tone="danger" />
            <HealthStat label="Uyarı" value={stats.warnings} tone="warning" />
            <HealthStat label="Bilgi" value={stats.info} tone="info" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading || Boolean(fixingId) || undoing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw size={15} />
              Yenile
            </button>
            <button
              type="button"
              onClick={() => setFixAllOpen(true)}
              disabled={loading || Boolean(fixingId) || undoing || fixableIssues.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
            >
              <Wrench size={15} />
              Güvenli düzeltmeleri uygula
            </button>
            {snoozedIssueIds.length > 0 ? (
              <button
                type="button"
                onClick={() => setSnoozedIssueIds([])}
                disabled={loading || Boolean(fixingId) || undoing}
                className="inline-flex items-center gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2 text-sm font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
              >
                <Activity size={15} />
                {snoozedIssueIds.length} ertelenen uyariyi geri getir
              </button>
            ) : null}
            {undoStack[0] ? (
              <button
                type="button"
                onClick={() => void handleUndo(undoStack[0])}
                disabled={loading || Boolean(fixingId) || undoing}
                className="inline-flex items-center gap-2 rounded-xl border border-warning/25 bg-warning/8 px-3 py-2 text-sm font-semibold text-warning transition hover:bg-warning/12 disabled:opacity-50"
              >
                <Undo2 size={15} />
                {undoing ? 'Geri alınıyor...' : 'Son düzeltmeyi geri al'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleFullExport()}
              disabled={loading || Boolean(fixingId) || undoing || resetting || exporting || restoring}
              className="inline-flex items-center gap-2 rounded-xl border border-success/25 bg-success/8 px-3 py-2 text-sm font-semibold text-success transition hover:bg-success/12 disabled:opacity-50"
            >
              <Download size={15} />
              {exporting ? 'Yedek alınıyor...' : 'JSON yedek'}
            </button>
            <button
              type="button"
              onClick={() => restoreFileRef.current?.click()}
              disabled={loading || Boolean(fixingId) || undoing || resetting || restoring}
              className="inline-flex items-center gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2 text-sm font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
            >
              <Upload size={15} />
              Yedekten geri yükle
            </button>
            <input ref={restoreFileRef} type="file" accept="application/json,.json" onChange={handleRestoreFile} className="hidden" aria-label="Geri yüklenecek yedek dosyasını seç" />
            <button
              type="button"
              onClick={() => downloadDataCsv(data)}
              disabled={loading || Boolean(fixingId) || undoing || resetting}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              <Download size={15} />
              CSV yedek
            </button>
            <button
              type="button"
              onClick={() => {
                setResetConfirm('')
                setResetOpen(true)
              }}
              disabled={loading || Boolean(fixingId) || undoing || resetting}
              className="inline-flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/12 disabled:opacity-50"
            >
              <DatabaseZap size={15} />
              Tüm veriyi sil
            </button>
          </div>
          {message ? <p className="rounded-xl border border-success/20 bg-success/8 p-3 text-sm font-medium text-success">{message}</p> : null}
          {error ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p> : null}
        </CardContent>
      </SurfaceCard>

      {!loading && data.cards.length > 0 ? <LiveReconciliationPanel cards={data.cards} /> : null}

      <NotificationSettings />

      {loading ? (
        <div className="skeleton-shimmer h-32 rounded-2xl" />
      ) : visibleIssues.length === 0 && issues.length > 0 ? (
        <SurfaceCard variant="default" className="border-info/20">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-info/12 text-info">
              <Activity size={22} />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Aktif listede uyari kalmadi</h2>
              <p className="mt-1 text-sm text-muted-foreground">Bulunan kayitlari daha sonra hatirlat olarak erteledin. Istersen yukaridan geri getirebilirsin.</p>
            </div>
          </CardContent>
        </SurfaceCard>
      ) : visibleIssues.length === 0 ? (
        <SurfaceCard variant="default" className="border-success/20">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <h2 className="font-bold text-foreground">Kayıtlar temiz görünüyor</h2>
              <p className="mt-1 text-sm text-muted-foreground">Otomatik kontrolün yakaladığı bir tutarsızlık yok.</p>
            </div>
          </CardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-3">
          {visibleIssues.map((issue) => (
            <HealthIssueCard
              key={issue.id}
              issue={issue}
              fixingId={fixingId}
              undoing={undoing}
              onFix={(target) => void handleFix(target)}
              onSnooze={(issueId) => setSnoozedIssueIds((current) => (current.includes(issueId) ? current : [...current, issueId]))}
            />
          ))}
        </div>
      )}
    </section>

    <FixAllModal
      open={fixAllOpen}
      onClose={() => setFixAllOpen(false)}
      fixableIssues={fixableIssues}
      fixingId={fixingId}
      undoing={undoing}
      onConfirm={() => void handleFixAll()}
    />

    <ResetDataModal
      open={resetOpen}
      onClose={() => setResetOpen(false)}
      resetConfirm={resetConfirm}
      onResetConfirmChange={setResetConfirm}
      resetting={resetting}
      onSubmit={handleResetAllData}
    />

    <RestoreBackupModal
      restoreParsed={restoreParsed}
      restoring={restoring}
      restoreConfirm={restoreConfirm}
      onRestoreConfirmChange={setRestoreConfirm}
      restoreStep={restoreStep}
      onClose={() => { if (!restoring) setRestoreParsed(null) }}
      onSubmit={handleRestore}
    />
    </>
  )
}

