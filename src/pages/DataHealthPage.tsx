import { Activity, CheckCircle2, RefreshCw, Settings, ShieldCheck, Undo2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { LiveReconciliationPanel } from '../components/finance/LiveReconciliationPanel'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  fetchDataHealthRows,
} from '../data/repositories/dataHealthRepo'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import { formatDate } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import {
  buildIssues,
  type HealthData,
  type HealthIssue,
  type UndoBatch,
  type UndoEntry,
} from './DataHealth.logic'
import {
  applyUndoEntry,
  emptyData,
  makeUndoBatch,
} from './DataHealth.actions'
import { fixIssue } from './DataHealthPage.actions'
import {
  FixAllModal,
  HealthIssueCard,
  HealthStat,
} from './DataHealthPage.components'

export function DataHealthPage() {
  const { formatAmount } = useBalancePrivacy()
  const [data, setData] = useState<HealthData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [undoStack, setUndoStack] = useState<UndoBatch[]>([])
  const [undoing, setUndoing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [snoozedIssueIds, setSnoozedIssueIds] = useState<string[]>([])
  const [dismissedIssueIds, setDismissedIssueIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('datahealth:dismissed') ?? '[]') }
    catch { return [] }
  })
  const [fixAllOpen, setFixAllOpen] = useState(false)
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()

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
  const dismissIssue = useCallback((issueId: string) => {
    setDismissedIssueIds((current) => {
      if (current.includes(issueId)) return current
      const next = [...current, issueId]
      localStorage.setItem('datahealth:dismissed', JSON.stringify(next))
      return next
    })
  }, [])

  const undismissAll = useCallback(() => {
    setDismissedIssueIds([])
    localStorage.removeItem('datahealth:dismissed')
  }, [])

  const visibleIssues = useMemo(() => issues.filter((issue) => !snoozedIssueIds.includes(issue.id) && !dismissedIssueIds.includes(issue.id)), [issues, snoozedIssueIds, dismissedIssueIds])
  const fixableIssues = visibleIssues.filter((issue) => issue.fixable)
  const stats = {
    errors: visibleIssues.filter((issue) => issue.severity === 'error').length,
    warnings: visibleIssues.filter((issue) => issue.severity === 'warning').length,
    info: visibleIssues.filter((issue) => issue.severity === 'info').length,
  }
  const integrityStats = {
    exactDuplicates: visibleIssues.filter((issue) => issue.kind === 'duplicateTransactionCandidate' && issue.payload?.duplicateLevel === 'exact').length,
    possibleDuplicates: visibleIssues.filter((issue) => issue.kind === 'duplicateTransactionCandidate' && issue.payload?.duplicateLevel === 'possible').length,
    missingDescriptions: visibleIssues.find((issue) => issue.id === 'card-expense-missing-description')?.payload?.ids?.length ?? 0,
    missingCategories: visibleIssues.find((issue) => issue.id === 'card-expense-missing-category')?.payload?.ids?.length ?? 0,
  }
  const derivedFieldStats = useMemo(() => {
    const creditCards = data.cards.filter((c) => c.card_type === 'kredi_karti')
    const bankCards = data.cards.filter((c) => c.card_type === 'banka_karti')
    const debtDriftCount = visibleIssues.filter((issue) => issue.id.startsWith('card-ledger-drift-')).length
    const balanceDriftCount = visibleIssues.filter((issue) => issue.id.startsWith('account-ledger-drift-')).length
    const splitDriftCount = visibleIssues.filter((issue) => issue.id.startsWith('card-split-')).length
    const loanDriftCount = visibleIssues.filter((issue) => issue.id.startsWith('loan-totals-')).length
    return {
      debtOk: creditCards.length - debtDriftCount,
      debtDrift: debtDriftCount,
      balanceOk: bankCards.length - balanceDriftCount,
      balanceDrift: balanceDriftCount,
      splitOk: creditCards.length - splitDriftCount,
      splitDrift: splitDriftCount,
      loanOk: data.loans.length - loanDriftCount,
      loanDrift: loanDriftCount,
      totalChecked: creditCards.length + bankCards.length + data.loans.length,
      totalDrift: debtDriftCount + balanceDriftCount + splitDriftCount + loanDriftCount,
    }
  }, [data.cards, data.loans, visibleIssues])

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

  async function handlePayIssue(issue: HealthIssue) {
    if (issue.kind !== 'cardOverduePayment') return

    const statement = data.cardStatementArchives.find((item) => item.id === issue.payload?.statementArchiveId)
    const card = data.cards.find((item) => item.id === issue.payload?.cardId)
    if (!statement || !card) {
      setError('Ödeme çekmecesi açılamadı: ekstre veya kart kaydı bulunamadı.')
      return
    }

    await openPaymentDrawer(
      {
        id: `data-health-card-statement-${statement.id}`,
        kind: 'card_statement',
        action: 'pay_card_statement',
        sourceId: statement.id,
        relatedCardId: card.id,
        title: `${card.card_name} ekstresi`,
        subtitle: card.bank_name,
        date: statement.due_date ?? statement.statement_date,
        amount: statement.statement_debt_amount,
        direction: 'outflow',
      },
      {
        cards: data.cards,
        reload: loadData,
        detail: (
          <>
            <p className="font-semibold text-foreground">{card.card_name}</p>
            <p>Son ödeme: {formatDate(statement.due_date)}</p>
            <p>Ekstre tutarı: <span className="font-mono font-semibold text-foreground">{formatAmount(statement.statement_debt_amount)}</span></p>
          </>
        ),
        formatSubmitError: (error) =>
          isMissingSupabaseCapabilityError(error)
            ? missingSupabaseCapabilityMessage('Ekstre ödeme altyapısı', error)
            : error.message ?? 'Ekstre ödenemedi.',
      },
    )
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
                  {snoozedIssueIds.length} ertelenen uyarıyı geri getir
                </button>
              ) : null}
              {dismissedIssueIds.length > 0 ? (
                <button
                  type="button"
                  onClick={undismissAll}
                  disabled={loading || Boolean(fixingId) || undoing}
                  className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  <Activity size={15} />
                  {dismissedIssueIds.length} kapatılan uyarıyı geri getir
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
              <Link
                to="/veri-sagligi/islemler"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                <Settings size={15} />
                Yedek & ayarlar
              </Link>
            </div>
            {message ? <p className="rounded-xl border border-success/20 bg-success/8 p-3 text-sm font-medium text-success">{message}</p> : null}
            {error ? <p className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm font-medium text-destructive">{error}</p> : null}
          </CardContent>
        </SurfaceCard>

        {!loading && data.cards.length > 0 ? <LiveReconciliationPanel cards={data.cards} /> : null}

        {!loading ? (
          <SurfaceCard variant="default">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-foreground">Türetilmiş alan tutarlılığı</h2>
                  <p className="mt-1 text-sm text-muted-foreground">DB'deki özet alanları (borç, bakiye, kredi kalanı) kaynak verilerle eşleşiyor mu?</p>
                </div>
                <Badge variant={derivedFieldStats.totalDrift > 0 ? 'warning' : 'success'}>
                  {derivedFieldStats.totalDrift === 0 ? 'Tutarlı' : `${derivedFieldStats.totalDrift} sapma`}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <HealthStat label="Kart borcu" value={derivedFieldStats.debtOk} tone={derivedFieldStats.debtDrift > 0 ? 'warning' : 'neutral'} />
                <HealthStat label="Hesap bakiye" value={derivedFieldStats.balanceOk} tone={derivedFieldStats.balanceDrift > 0 ? 'warning' : 'neutral'} />
                <HealthStat label="Borç kırılımı" value={derivedFieldStats.splitOk} tone={derivedFieldStats.splitDrift > 0 ? 'warning' : 'neutral'} />
                <HealthStat label="Kredi özeti" value={derivedFieldStats.loanOk} tone={derivedFieldStats.loanDrift > 0 ? 'warning' : 'neutral'} />
              </div>
            </CardContent>
          </SurfaceCard>
        ) : null}

        {!loading ? (
          <SurfaceCard variant="default">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-foreground">İşlem güvenilirliği</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Kart harcamalarında duplicate ve eksik sınıflandırma sinyalleri.</p>
                </div>
                <Badge variant={integrityStats.exactDuplicates > 0 || integrityStats.possibleDuplicates > 0 ? 'warning' : 'success'}>
                  Mutabakat
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <HealthStat label="Kesin duplicate" value={integrityStats.exactDuplicates} tone={integrityStats.exactDuplicates > 0 ? 'warning' : 'neutral'} />
                <HealthStat label="Muhtemel duplicate" value={integrityStats.possibleDuplicates} tone={integrityStats.possibleDuplicates > 0 ? 'info' : 'neutral'} />
                <HealthStat label="Açıklamasız" value={integrityStats.missingDescriptions} tone={integrityStats.missingDescriptions > 0 ? 'info' : 'neutral'} />
                <HealthStat label="Kategorisiz" value={integrityStats.missingCategories} tone={integrityStats.missingCategories > 0 ? 'info' : 'neutral'} />
              </div>
            </CardContent>
          </SurfaceCard>
        ) : null}

        {loading ? (
          <div className="skeleton-shimmer h-32 rounded-2xl" />
        ) : visibleIssues.length === 0 && issues.length > 0 ? (
          <SurfaceCard variant="default" className="border-info/20">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-info/12 text-info">
                <Activity size={22} />
              </div>
              <div>
                <h2 className="font-bold text-foreground">Aktif listede uyarı kalmadı</h2>
                <p className="mt-1 text-sm text-muted-foreground">Bulunan kayıtları daha sonra hatırlat olarak erteledin. İstersen yukarıdan geri getirebilirsin.</p>
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
                onPayIssue={(target) => void handlePayIssue(target)}
                onSnooze={(issueId) => setSnoozedIssueIds((current) => (current.includes(issueId) ? current : [...current, issueId]))}
                onDismiss={dismissIssue}
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
      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}
