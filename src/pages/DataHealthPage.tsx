import { Activity, AlertTriangle, CheckCircle2, DatabaseZap, Download, RefreshCw, ShieldCheck, Trash2, Undo2, Upload, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { LiveReconciliationPanel } from '../components/finance/LiveReconciliationPanel'
import { SimpleModal } from '../components/SimpleModal'
import {
  BACKUP_TABLE_LABELS,
  buildBackupPayload,
  downloadBackupFile,
  parseBackup,
  restoreBackup,
  type ParsedBackup,
} from '../utils/backup'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { supabase } from '../lib/supabase'
import type {
  Asset,
  Budget,
  Card,
  CardExpense,
  CardInstallment,
  CardStatementArchive,
  Debt,
  InsertFor,
  Loan,
  LoanInstallment,
  Payment,
  SalaryHistory,
  SavingsGoal,
  SavingsGoalComponent,
  UpdateFor,
} from '../types/database'
import { roundMoney } from '../utils/financeSummary'
import {
  addMonthsToMonthStart,
  applyUndoEntry,
  buildIssueGuide,
  buildIssues,
  captureUndoRows,
  currentMonthStart,
  downloadDataCsv,
  emptyData,
  isSchemaCacheError,
  issuePreviewDetails,
  makeUndoBatch,
  navigationAction,
  severityClass,
  type HealthData,
  type HealthIssue,
  type UndoBatch,
  type UndoEntry,
  type UndoTable,
} from './DataHealth.logic'

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

    const [
      assets,
      budgets,
      cards,
      cardExpenses,
      cardInstallments,
      cardStatementArchives,
      debts,
      loans,
      loanInstallments,
      payments,
      salaryHistory,
      savingsGoals,
      savingsGoalComponents,
    ] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('budgets').select('*'),
      supabase.from('cards').select('*'),
      supabase.from('card_expenses').select('*'),
      supabase.from('card_installments').select('*'),
      supabase.from('card_statement_archives').select('*'),
      supabase.from('debts').select('*'),
      supabase.from('loans').select('*'),
      supabase.from('loan_installments').select('*'),
      supabase.from('payments').select('*'),
      supabase.from('salary_history').select('*'),
      supabase.from('savings_goals').select('*'),
      supabase.from('savings_goal_components').select('*'),
    ])

    const firstError = [
      assets.error,
      budgets.error,
      cards.error,
      cardExpenses.error,
      cardInstallments.error,
      cardStatementArchives.error,
      debts.error,
      loans.error,
      loanInstallments.error,
      payments.error,
      salaryHistory.error,
      savingsGoals.error,
      savingsGoalComponents.error,
    ].find(Boolean)
    if (firstError) {
      setError(firstError.message)
    } else {
      setData({
        assets: (assets.data ?? []) as Asset[],
        budgets: (budgets.data ?? []) as Budget[],
        cards: (cards.data ?? []) as Card[],
        cardExpenses: (cardExpenses.data ?? []) as CardExpense[],
        cardInstallments: (cardInstallments.data ?? []) as CardInstallment[],
        cardStatementArchives: (cardStatementArchives.data ?? []) as CardStatementArchive[],
        debts: (debts.data ?? []) as Debt[],
        loans: (loans.data ?? []) as Loan[],
        loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
        payments: (payments.data ?? []) as Payment[],
        salaryHistory: (salaryHistory.data ?? []) as SalaryHistory[],
        savingsGoals: (savingsGoals.data ?? []) as SavingsGoal[],
        savingsGoalComponents: (savingsGoalComponents.data ?? []) as SavingsGoalComponent[],
      })
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
      const { error: updateError } = await supabase
        .from('assets')
        .update({ ...(payload.updates as UpdateFor<'assets'>), updated_at: new Date().toISOString() })
        .eq('id', payload.assetId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'budgetMonth' && payload.budgetId && payload.updates) {
      await addUndo('budgets', [payload.budgetId])
      const { error: updateError } = await supabase
        .from('budgets')
        .update({ ...(payload.updates as UpdateFor<'budgets'>), updated_at: new Date().toISOString() })
        .eq('id', payload.budgetId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardDebtSplit' && payload.cardId) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          statement_debt_amount: payload.statementDebt ?? 0,
          current_period_spending: payload.currentPeriod ?? 0,
          provision_amount: payload.provisionAmount ?? 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardScheduledDebt' && payload.cardId && payload.nextDebtAmount !== undefined) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({
          debt_amount: payload.nextDebtAmount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardTypeFields' && payload.cardId && payload.updates) {
      await addUndo('cards', [payload.cardId])
      const { error: updateError } = await supabase
        .from('cards')
        .update({ ...(payload.updates as UpdateFor<'cards'>), updated_at: new Date().toISOString() })
        .eq('id', payload.cardId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardExpenseAmount' && payload.expenseId && payload.updates) {
      await addUndo('card_expenses', [payload.expenseId])
      const { error: updateError } = await supabase
        .from('card_expenses')
        .update({ ...(payload.updates as UpdateFor<'card_expenses'>), updated_at: new Date().toISOString() })
        .eq('id', payload.expenseId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardSingleInstallments' && payload.ids?.length) {
      await addUndo('card_installments', payload.ids)
      const { error: deleteError } = await supabase.from('card_installments').delete().in('id', payload.ids)
      if (deleteError) throw new Error(deleteError.message)
    }

    if ((issue.kind === 'cardInstallmentDueMonth' || issue.kind === 'cardInstallmentPostedAt' || issue.kind === 'cardInstallmentCount') && payload.ids?.length && payload.updates) {
      await addUndo('card_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('card_installments')
        .update({ ...(payload.updates as UpdateFor<'card_installments'>), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'cardStatementTotals' && payload.statementArchiveId && payload.updates) {
      await addUndo('card_statement_archives', [payload.statementArchiveId])
      const { error: updateError } = await supabase
        .from('card_statement_archives')
        .update({ ...(payload.updates as UpdateFor<'card_statement_archives'>), updated_at: new Date().toISOString() })
        .eq('id', payload.statementArchiveId)
      if (updateError) throw new Error(updateError.message)
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

      const { data: insertedRows, error: insertError } = await supabase.from('card_installments').insert(rows).select('id')
      if (insertError) throw new Error(insertError.message)
      const insertedIds = (insertedRows ?? []).map((row) => row.id).filter(Boolean)
      if (insertedIds.length > 0) {
        undoEntries.push({ action: 'deleteRows', table: 'card_installments', ids: insertedIds })
      }
    }

    if (issue.kind === 'debtShape' && payload.debtId && payload.updates) {
      await addUndo('debts', [payload.debtId])
      const { error: updateError } = await supabase
        .from('debts')
        .update({ ...(payload.updates as UpdateFor<'debts'>), updated_at: new Date().toISOString() })
        .eq('id', payload.debtId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanTotals' && payload.loanId) {
      await addUndo('loans', [payload.loanId])
      const { error: updateError } = await supabase
        .from('loans')
        .update({
          remaining_amount: payload.remainingAmount ?? 0,
          remaining_installments: payload.remainingInstallments ?? 0,
          status: payload.loanStatus ?? 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', payload.loanId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanInstallmentDueDay' && payload.ids?.length && payload.updates) {
      await addUndo('loan_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ ...(payload.updates as UpdateFor<'loan_installments'>), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanPaidAtMissing' && payload.ids?.length) {
      await addUndo('loan_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'loanPendingPaidAt' && payload.ids?.length) {
      await addUndo('loan_installments', payload.ids)
      const { error: updateError } = await supabase
        .from('loan_installments')
        .update({ paid_at: null, updated_at: new Date().toISOString() })
        .in('id', payload.ids)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'paymentDueDay' && payload.paymentId && payload.dueDate) {
      await addUndo('payments', [payload.paymentId])
      const { error: updateError } = await supabase
        .from('payments')
        .update({ due_date: payload.dueDate, updated_at: new Date().toISOString() })
        .eq('id', payload.paymentId)
      if (updateError) throw new Error(updateError.message)
    }

    if (issue.kind === 'paymentRecurrenceFields' && payload.paymentId && payload.updates) {
      await addUndo('payments', [payload.paymentId])
      const { error: updateError } = await supabase
        .from('payments')
        .update({ ...(payload.updates as UpdateFor<'payments'>), updated_at: new Date().toISOString() })
        .eq('id', payload.paymentId)
      if (updateError) throw new Error(updateError.message)
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

    const { error: resetError } = await supabase.rpc('reset_user_finance_data', {})
    if (resetError) {
      setError(
        isSchemaCacheError(resetError)
          ? 'Sıfırlama altyapısı canlı veritabanına uygulanmamış. Migration çalışınca bu işlem açılacak.'
          : resetError.message,
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
          {visibleIssues.map((issue) => {
            const guide = buildIssueGuide(issue)
            const quickLink = navigationAction(issue)
            const previewRows = issuePreviewDetails(issue)

            return (
              <SurfaceCard key={issue.id} variant="default">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${severityClass(issue.severity)}`}>
                      {issue.fixable ? <Wrench size={19} /> : issue.severity === 'info' ? <Activity size={19} /> : <AlertTriangle size={19} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{issue.area}</Badge>
                        <Badge variant={issue.fixable ? 'success' : 'outline'}>{issue.fixable ? 'Hazir aksiyon var' : 'Elle inceleme gerekli'}</Badge>
                      </div>
                      <h2 className="mt-2 text-base font-bold text-foreground">{issue.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
                      <div className="mt-3 grid gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
                        <div>
                          <p className="font-semibold text-foreground">Sorun nedir?</p>
                          <p className="mt-1 text-muted-foreground">{guide.problem}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">Neden onemli?</p>
                          <p className="mt-1 text-muted-foreground">{guide.whyItMatters}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">Ne yapmaliyim?</p>
                          <p className="mt-1 text-muted-foreground">{guide.nextStep}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                        {issue.details.map((detail) => (
                          <span key={detail}>{detail}</span>
                        ))}
                      </div>
                      {previewRows.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-success/20 bg-success/8 p-3 text-xs text-success">
                          <p className="font-bold">Duzeltme onizlemesi</p>
                          <div className="mt-2 grid gap-1">
                            {previewRows.map((detail, index) => (
                              <span key={`${issue.id}-preview-${index}`}>{detail}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-3">
                        <p className="finance-label">Hızlı aksiyonlar</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {issue.fixable ? (
                            <button
                              type="button"
                              onClick={() => void handleFix(issue)}
                              disabled={Boolean(fixingId) || undoing}
                              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
                            >
                              {fixingId === issue.id ? 'Duzeltiliyor...' : issue.fixLabel}
                            </button>
                          ) : null}
                          {quickLink ? (
                            <Link to={quickLink.to} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted">
                              {quickLink.label}
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setSnoozedIssueIds((current) => (current.includes(issue.id) ? current : [...current, issue.id]))}
                            disabled={Boolean(fixingId) || undoing}
                            className="rounded-lg border border-info/25 bg-info/8 px-3 py-2 text-xs font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
                          >
                            Daha sonra hatirlat
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </SurfaceCard>
            )
          })}
        </div>
      )}
    </section>

    <SimpleModal title="Toplu düzeltmeyi onayla" open={fixAllOpen} onClose={() => setFixAllOpen(false)}>
      <div className="space-y-4">
        <div className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm text-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">Toplu işlem {fixableIssues.length} kaydı etkileyebilir.</p>
              <p className="mt-1">
                Her düzeltmeden önce ilgili satırların bu oturumluk geri alma görüntüsü alınır. İşlem yarıda kalırsa başarılı adımlar yine geri alınabilir.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
          <p className="text-xs font-bold uppercase text-muted-foreground">İlk düzeltmeler</p>
          <div className="mt-2 grid gap-2">
            {fixableIssues.slice(0, 5).map((issue) => (
              <div key={issue.id} className="rounded-lg bg-card/80 px-3 py-2 text-sm ring-1 ring-border/60">
                <p className="font-semibold text-foreground">{issue.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{issue.fixLabel}</p>
              </div>
            ))}
            {fixableIssues.length > 5 ? (
              <p className="text-xs font-semibold text-muted-foreground">+{fixableIssues.length - 5} düzeltme daha</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleFixAll()}
          disabled={Boolean(fixingId) || undoing || fixableIssues.length === 0}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
        >
          <Wrench size={16} />
          {fixingId === 'all' ? 'Düzeltiliyor...' : 'Toplu düzeltmeyi uygula'}
        </button>
      </div>
    </SimpleModal>

    <SimpleModal title="Tüm veriyi sil" open={resetOpen} onClose={() => setResetOpen(false)}>
      <form onSubmit={handleResetAllData} className="space-y-4">
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-destructive">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">Bu işlem geri alınamaz.</p>
              <p className="mt-1">
                Varlıklar, kartlar, harcamalar, ekstre arşivi, krediler, borç/alacaklar, ödemeler, bütçeler, hedefler,
                maaş geçmişi ve işlem geçmişi silinir.
              </p>
            </div>
          </div>
        </div>
        <label className="block text-sm font-semibold text-foreground">
          Onay için SİL yaz
          <input
            value={resetConfirm}
            onChange={(event) => setResetConfirm(event.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-input bg-card/80 px-3 text-sm text-foreground outline-none transition-all focus:border-destructive focus:ring-2 focus:ring-destructive/20 dark:bg-card/50"
          />
        </label>
        <button
          type="submit"
          disabled={resetting}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--destructive)_30%,transparent)] transition hover:bg-destructive/90 active:scale-[0.99] disabled:opacity-50"
        >
          <DatabaseZap size={16} />
          {resetting ? 'Siliniyor...' : 'Tüm veriyi kalıcı olarak sil'}
        </button>
      </form>
    </SimpleModal>

    <SimpleModal title="Yedekten geri yükle" open={restoreParsed !== null} onClose={() => { if (!restoring) setRestoreParsed(null) }}>
      {restoreParsed ? (
        <form onSubmit={handleRestore} className="space-y-4">
          <div className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm text-warning">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-bold">Mevcut tüm veri silinip yedektekiyle değiştirilir.</p>
                <p className="mt-1">
                  Güvenlik için işlem başlamadan önce mevcut verinin tam JSON yedeği otomatik indirilir.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
            <p className="font-semibold text-foreground">
              {restoreParsed.totalRows} kayıt geri yüklenecek
              {restoreParsed.exportedAt ? ` · Yedek tarihi: ${restoreParsed.exportedAt.slice(0, 10)}` : ''}
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {restoreParsed.counts.map(({ table, rows }) => (
                <li key={table}>{BACKUP_TABLE_LABELS[table]}: <span className="font-semibold tabular-nums">{rows}</span></li>
              ))}
            </ul>
          </div>
          <label className="block text-sm font-semibold text-foreground">
            Onay için YÜKLE yaz
            <input
              value={restoreConfirm}
              onChange={(event) => setRestoreConfirm(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-input bg-card/80 px-3 text-sm text-foreground outline-none transition-all focus:border-warning focus:ring-2 focus:ring-warning/20 dark:bg-card/50"
            />
          </label>
          <button
            type="submit"
            disabled={restoring}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            <Upload size={16} />
            {restoring ? `${restoreStep || 'Geri yükleniyor'}...` : 'Yedeği geri yükle'}
          </button>
        </form>
      ) : null}
    </SimpleModal>
    </>
  )
}

function HealthStat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'danger' | 'warning' | 'info' }) {
  const toneClass =
    tone === 'danger' ? 'text-destructive' :
    tone === 'warning' ? 'text-warning' :
    tone === 'info' ? 'text-info' :
    'text-foreground'
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
      <p className="finance-label truncate">{label}</p>
      <p className={`finance-value mt-1 truncate text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
