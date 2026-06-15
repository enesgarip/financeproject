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
  fetchDataHealthRows,
  resetUserFinanceData,
} from '../data/repositories/dataHealthRepo'
import {
  applyUndoEntry,
  buildIssues,
  downloadDataCsv,
  emptyData,
  makeUndoBatch,
  type HealthData,
  type HealthIssue,
  type UndoBatch,
  type UndoEntry,
} from './DataHealth.logic'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import { fixIssue } from './DataHealthPage.actions'
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
        isMissingSupabaseCapabilityError(resetError.error)
          ? missingSupabaseCapabilityMessage('Sıfırlama altyapısı', resetError.error)
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
                {snoozedIssueIds.length} ertelenen uyarıyı geri getir
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

