import { Activity, CheckCircle2, RefreshCw, Settings, Undo2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { FinancePaymentDrawer } from '../components/finance/FinancePaymentDrawer'
import { BreakdownBar, HeroNumber } from '../components/serit'
import { LiveReconciliationPanel } from '../components/finance/LiveReconciliationPanel'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent } from '../components/ui/card'
import {
  acknowledgeDataHealthIssues,
  clearDataHealthIssueAcknowledgements,
  fetchDataHealthIssueAcknowledgements,
  fetchDataHealthRows,
} from '../data/repositories/dataHealthRepo'
import {
  cancelCardExpense,
  updateCardExpenseHealthMetadata,
  type UpdateCardExpenseHealthMetadataInput,
} from '../data/repositories/cardsRepo'
import { useFinancePaymentDrawer } from '../hooks/useFinancePaymentDrawer'
import {
  applyDataHealthSafeRepairs,
  createDataHealthRepairIdempotencyKey,
  type DataHealthSafeRepair,
} from '../services/dataHealthRepairs'
import { formatDate } from '../utils/date'
import { useBalancePrivacy } from '../hooks/useBalancePrivacy'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import {
  buildAreaCoverage,
  buildIssues,
  type HealthData,
  type HealthIssue,
  type UndoBatch,
} from './DataHealth.logic'
import {
  applyUndoEntry,
  emptyData,
} from './DataHealth.actions'
import {
  fixIssue,
  safeRepairBatchForIssues,
  safeRepairPlanForIssues,
} from './DataHealthPage.actions'
import {
  FixAllModal,
  HealthIssueCard,
  HealthStat,
} from './DataHealthPage.components'
import { resolveHealthIssue } from './DataHealth.resolution'
import { DataHealthCardExpenseReview } from './DataHealthCardExpenseReview'

const LEGACY_DISMISSED_ISSUES_KEY = 'datahealth:dismissed'

function readLegacyDismissedIssueIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_DISMISSED_ISSUES_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .filter((issueId): issueId is string => typeof issueId === 'string')
      .map((issueId) => issueId.trim())
      .filter(Boolean))]
  } catch {
    return []
  }
}

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
  const [dismissedIssueIds, setDismissedIssueIds] = useState<string[]>(readLegacyDismissedIssueIds)
  const [acknowledgementBusy, setAcknowledgementBusy] = useState(false)
  const [fixAllOpen, setFixAllOpen] = useState(false)
  const [fixAllRequest, setFixAllRequest] = useState<{
    repairs: DataHealthSafeRepair[]
    issues: HealthIssue[]
    idempotencyKey: string
    remainingRepairCount: number
  } | null>(null)
  const [reviewIssue, setReviewIssue] = useState<HealthIssue | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const { drawerProps, openPaymentDrawer } = useFinancePaymentDrawer()

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    setMessage('')

    const [result, acknowledgementResult] = await Promise.all([
      fetchDataHealthRows(),
      fetchDataHealthIssueAcknowledgements(),
    ])
    if (!result.ok) {
      setError(result.error.message ?? 'Veri sağlığı kayıtları yüklenemedi.')
      setLoading(false)
      return null
    }

    if (!acknowledgementResult.ok) {
      setError(acknowledgementResult.error.message ?? 'Kapatılan veri sağlığı bulguları yüklenemedi.')
      setLoading(false)
      return null
    }

    setData(result.data)
    const legacyIds = readLegacyDismissedIssueIds()
    const serverIds = acknowledgementResult.data
    const missingLegacyIds = legacyIds.filter((issueId) => !serverIds.includes(issueId))
    let nextDismissedIds = [...new Set([...serverIds, ...legacyIds])]

    if (missingLegacyIds.length > 0) {
      const migrationResult = await acknowledgeDataHealthIssues(missingLegacyIds)
      if (migrationResult.ok) {
        localStorage.removeItem(LEGACY_DISMISSED_ISSUES_KEY)
      } else {
        setError(`${migrationResult.error.message} Bu cihazdaki eski kapatma seçimleri korunuyor.`)
      }
    } else if (legacyIds.length > 0) {
      localStorage.removeItem(LEGACY_DISMISSED_ISSUES_KEY)
      nextDismissedIds = serverIds
    }

    setDismissedIssueIds(nextDismissedIds)

    setLoading(false)
    return result.data
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData()
  }, [loadData])

  const issues = useMemo(() => buildIssues(data), [data])
  const dismissIssue = useCallback(async (issueId: string) => {
    setAcknowledgementBusy(true)
    setError('')
    const result = await acknowledgeDataHealthIssues([issueId])
    if (result.ok) {
      setDismissedIssueIds((current) => current.includes(issueId) ? current : [...current, issueId])
      setMessage('Bulgu doğru olarak işaretlendi; bu hesapta tüm cihazlarda kapalı kalacak.')
    } else {
      setError(result.error.message ?? 'Bulgu doğru olarak işaretlenemedi.')
    }
    setAcknowledgementBusy(false)
  }, [])

  const undismissAll = useCallback(async () => {
    setAcknowledgementBusy(true)
    setError('')
    const result = await clearDataHealthIssueAcknowledgements()
    if (result.ok) {
      setDismissedIssueIds([])
      localStorage.removeItem(LEGACY_DISMISSED_ISSUES_KEY)
      setMessage('Kapatılan veri sağlığı bulguları bu hesap için geri getirildi.')
    } else {
      setError(result.error.message ?? 'Kapatılan bulgular geri getirilemedi.')
    }
    setAcknowledgementBusy(false)
  }, [])

  const visibleIssues = useMemo(() => issues.filter((issue) => !snoozedIssueIds.includes(issue.id) && !dismissedIssueIds.includes(issue.id)), [issues, snoozedIssueIds, dismissedIssueIds])
  const bulkIssues = visibleIssues.filter((issue) => resolveHealthIssue(issue).bulkEligible)
  const safeRepairPlan = useMemo(() => safeRepairPlanForIssues(visibleIssues), [visibleIssues])
  const coverage = useMemo(() => buildAreaCoverage(visibleIssues), [visibleIssues])
  const stats = {
    errors: visibleIssues.filter((issue) => issue.severity === 'error').length,
    warnings: visibleIssues.filter((issue) => issue.severity === 'warning').length,
    info: visibleIssues.filter((issue) => issue.severity === 'info').length,
  }
  const integrityStats = {
    sameFingerprint: visibleIssues.filter((issue) => issue.kind === 'duplicateTransactionCandidate' && issue.payload?.duplicateLevel === 'same_fingerprint').length,
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
      const resolution = resolveHealthIssue(issue)
      setMessage(
        undoBatch
          ? 'Düzeltme uygulandı. Bu oturumda geri alabilirsin.'
          : resolution.undoPolicy === 'not_available'
            ? 'Düzeltme kaynak veriden yeniden hesaplandı ve denetim fişine kaydedildi.'
            : 'Kart bakımı uygulandı; kayıtlar yeniden tarandı.',
      )
    } catch (fixError) {
      setError(fixError instanceof Error ? fixError.message : 'Düzeltme uygulanamadı.')
    } finally {
      setFixingId(null)
    }
  }

  async function handleFixAll() {
    if (!fixAllRequest) {
      setError('Güvenli düzeltme önizlemesi bulunamadı; veriyi yenileyip tekrar dene.')
      return
    }

    setFixAllOpen(false)
    setFixingId('all')
    setError('')
    setMessage('')
    try {
      const result = await applyDataHealthSafeRepairs(
        fixAllRequest.repairs,
        fixAllRequest.idempotencyKey,
      )
      if (result.error) throw new Error(result.error.message ?? 'Güvenli düzeltmeler uygulanamadı.')
      if (!result.receipt) throw new Error('Güvenli düzeltme sonucu alınamadı.')

      await loadData()
      if (result.receipt.status === 'running') {
        setError('Aynı güvenli düzeltme hâlâ sunucuda çalışıyor. Bulguları yenileyerek sonucu kontrol et.')
      } else if (result.receipt.status === 'conflict') {
        setError('Plan önizlendikten sonra veri değişti. Hiçbir düzeltme uygulanmadı; güncel bulguları tekrar incele.')
      } else if (result.receipt.status === 'failed') {
        setError(result.receipt.message ?? 'Toplu güvenli düzeltme tamamlanamadı; finans verisine dokunulmadı.')
      } else {
        const remainingMessage = fixAllRequest.remainingRepairCount > 0
          ? ` Kalan ${fixAllRequest.remainingRepairCount} çözüm güncel veriden sonraki turda önizlenebilir.`
          : ''
        setMessage(
          `${result.receipt.applied} güvenli düzeltme uygulandı, ${result.receipt.skipped} kayıt zaten tutarlıydı. Denetim: ${result.receipt.runId.slice(0, 8)}.${remainingMessage}`,
        )
      }
      setFixAllRequest(null)
    } catch (fixError) {
      await loadData()
      setError(
        fixError instanceof Error
          ? fixError.message
          : 'Toplu düzeltme tamamlanamadı; finans verisine dokunulmadı.',
      )
      // Yanıt ağda kaybolmuş olabilir. Aynı plan ve aynı işlem anahtarıyla
      // tekrar onaylamak sunucudan özgün denetim fişini güvenle döndürür.
      setFixAllOpen(true)
    } finally {
      setFixingId(null)
    }
  }

  async function openFixAllPreview() {
    const freshData = await loadData()
    if (!freshData) return

    const freshVisibleIssues = buildIssues(freshData).filter(
      (issue) => !snoozedIssueIds.includes(issue.id) && !dismissedIssueIds.includes(issue.id),
    )
    const batch = safeRepairBatchForIssues(freshVisibleIssues)
    if (batch.repairs.length === 0) {
      setMessage('Güncel kontrolde toplu uygulanabilecek güvenli bir çözüm kalmadı.')
      return
    }

    setFixAllRequest({
      ...batch,
      idempotencyKey: createDataHealthRepairIdempotencyKey(),
    })
    setFixAllOpen(true)
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
        reload: async () => {
          await loadData()
        },
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

  async function handleCancelDuplicate(expenseId: string) {
    setReviewBusy(true)
    setReviewError('')
    try {
      const result = await cancelCardExpense(expenseId)
      if (!result.ok) {
        setReviewError(result.error.message ?? 'Tekrarlanan harcama iptal edilemedi.')
        return
      }

      const loaded = await loadData()
      if (!loaded) {
        setReviewError('Harcama iptal edildi ancak güncel kontroller yüklenemedi. Sayfayı yenile.')
        return
      }
      setReviewIssue(null)
      setMessage('Seçili tekrarlanan kayıt, geçmiş silinmeden finans kuralına uygun iptalle terslendi.')
    } catch (cancelError) {
      setReviewError(
        cancelError instanceof Error ? cancelError.message : 'Tekrarlanan harcama iptal edilemedi.',
      )
    } finally {
      setReviewBusy(false)
    }
  }

  async function handleUpdateExpenseMetadata(input: UpdateCardExpenseHealthMetadataInput) {
    setReviewBusy(true)
    setReviewError('')
    try {
      const result = await updateCardExpenseHealthMetadata(input)
      if (!result.ok) {
        setReviewError(result.error.message ?? 'Harcama bilgileri güncellenemedi.')
        return
      }

      const loaded = await loadData()
      if (!loaded) {
        setReviewError('Harcama güncellendi ancak güncel kontroller yüklenemedi. Sayfayı yenile.')
        return
      }
      setReviewIssue(null)
      setMessage('Harcama açıklaması ve kategorisi güncellendi; kontroller yeniden çalıştı.')
    } catch (metadataError) {
      setReviewError(
        metadataError instanceof Error ? metadataError.message : 'Harcama bilgileri güncellenemedi.',
      )
    } finally {
      setReviewBusy(false)
    }
  }

  return (
    <>
      <section className="space-y-4">
        {/* Şerit (`3d`): kahraman = bulgu sayısı, altında tür kırılımı ve 6px oran çubuğu. */}
        <div>
          <HeroNumber
            label="Veri kontrolü"
            value={visibleIssues.length}
            tone={stats.errors > 0 ? 'danger' : visibleIssues.length > 0 ? 'warning' : 'brand'}
            unitOverride="bulgu"
            description={
              loading
                ? 'Kontroller çalışıyor…'
                : visibleIssues.length === 0
                  ? `${coverage.areasChecked} alanın hepsi temiz — ledger, bakiye, borç kırılımı ve sınıflandırmalarda sapma yok.`
                  : `${stats.errors} hata · ${stats.warnings} uyarı · ${stats.info} bilgi · ${coverage.cleanAreas}/${coverage.areasChecked} alan temiz`
            }
          />

          {visibleIssues.length > 0 ? (
            <div className="mt-4">
              <BreakdownBar
                height={6}
                showValues={false}
                segments={[
                  { label: 'Kritik', value: stats.errors, tone: 'danger' },
                  { label: 'Uyarı', value: stats.warnings, tone: 'warning' },
                  { label: 'Bilgi', value: stats.info, tone: 'info' },
                ]}
              />
            </div>
          ) : null}
        </div>

        <div className="border-t border-line pt-4">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loading || Boolean(fixingId) || undoing || acknowledgementBusy}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw size={15} />
                Yenile
              </button>
              <button
                type="button"
                onClick={() => void openFixAllPreview()}
                disabled={loading || Boolean(fixingId) || undoing || acknowledgementBusy || safeRepairPlan.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
              >
                <Wrench size={15} />
                Önizle ve güvenli çözümleri uygula
              </button>
              {snoozedIssueIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSnoozedIssueIds([])}
                  disabled={loading || Boolean(fixingId) || undoing || acknowledgementBusy}
                  className="inline-flex items-center gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2 text-sm font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
                >
                  <Activity size={15} />
                  {snoozedIssueIds.length} ertelenen uyarıyı geri getir
                </button>
              ) : null}
              {dismissedIssueIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void undismissAll()}
                  disabled={loading || Boolean(fixingId) || undoing || acknowledgementBusy}
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
                  disabled={loading || Boolean(fixingId) || undoing || acknowledgementBusy}
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
          </div>
        </div>

        {!loading && data.cards.length > 0 ? (
          <LiveReconciliationPanel
            cards={data.cards}
            onChanged={async () => {
              await loadData()
            }}
          />
        ) : null}

        {!loading ? (
          <SurfaceCard variant="default">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-foreground">Türetilmiş alan tutarlılığı</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Veritabanındaki özet alanları (borç, bakiye, kredi kalanı) kaynak verilerle eşleşiyor mu?</p>
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
                  <p className="mt-1 text-sm text-muted-foreground">Kart harcamalarında tekrar olasılığı ve eksik sınıflandırma sinyalleri.</p>
                </div>
                <Badge variant={integrityStats.sameFingerprint > 0 || integrityStats.possibleDuplicates > 0 ? 'warning' : 'success'}>
                  Mutabakat
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <HealthStat label="Aynı işlem izi" value={integrityStats.sameFingerprint} tone={integrityStats.sameFingerprint > 0 ? 'warning' : 'neutral'} />
                <HealthStat label="Olası tekrar" value={integrityStats.possibleDuplicates} tone={integrityStats.possibleDuplicates > 0 ? 'info' : 'neutral'} />
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
                fixingId={fixingId ?? (acknowledgementBusy ? 'acknowledgement' : null)}
                undoing={undoing}
                onFix={(target) => void handleFix(target)}
                onPayIssue={(target) => void handlePayIssue(target)}
                onReviewIssue={(target) => {
                  setReviewError('')
                  setReviewIssue(target)
                }}
                onSnooze={(issueId) => setSnoozedIssueIds((current) => (current.includes(issueId) ? current : [...current, issueId]))}
                onDismiss={(issueId) => void dismissIssue(issueId)}
              />
            ))}
          </div>
        )}
      </section>

      <FixAllModal
        open={fixAllOpen}
        onClose={() => {
          setFixAllOpen(false)
          setFixAllRequest(null)
        }}
        safeIssues={fixAllRequest?.issues ?? bulkIssues}
        repairCount={fixAllRequest?.repairs.length ?? 0}
        remainingRepairCount={fixAllRequest?.remainingRepairCount ?? 0}
        fixingId={fixingId}
        undoing={undoing}
        onConfirm={() => void handleFixAll()}
      />
      {reviewIssue ? (
        <DataHealthCardExpenseReview
          issue={reviewIssue}
          expenses={data.cardExpenses}
          cards={data.cards}
          busy={reviewBusy}
          error={reviewError}
          onClose={() => {
            if (!reviewBusy) setReviewIssue(null)
          }}
          onCancelDuplicate={(expenseId) => void handleCancelDuplicate(expenseId)}
          onUpdateMetadata={(input) => void handleUpdateExpenseMetadata(input)}
        />
      ) : null}
      <FinancePaymentDrawer {...drawerProps} />
    </>
  )
}
