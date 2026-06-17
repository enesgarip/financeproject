import { DatabaseZap, Download, Settings, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { NotificationSettings } from '../components/finance/NotificationSettings'
import { Alert } from '../components/ui/alert'
import { Card as SurfaceCard, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  buildBackupPayload,
  downloadBackupFile,
  parseBackup,
  restoreBackup,
  type ParsedBackup,
} from '../utils/backup'
import {
  fetchDataHealthRows,
  resetUserFinanceData,
} from '../data/repositories/dataHealthRepo'
import { downloadDataCsv } from './DataHealth.actions'
import { isMissingSupabaseCapabilityError, missingSupabaseCapabilityMessage } from '../utils/supabaseErrors'
import {
  ResetDataModal,
  RestoreBackupModal,
} from './DataHealthPage.components'

export function DataHealthOperationsPage() {
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetting, setResetting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [csvExporting, setCsvExporting] = useState(false)
  const [restoreParsed, setRestoreParsed] = useState<ParsedBackup | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreStep, setRestoreStep] = useState('')
  const restoreFileRef = useRef<HTMLInputElement>(null)

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

  async function handleCsvExport() {
    setCsvExporting(true)
    setError('')
    try {
      const result = await fetchDataHealthRows()
      if (!result.ok) {
        setError(result.error.message ?? 'CSV yedek için kayıtlar yüklenemedi.')
        return
      }
      downloadDataCsv(result.data)
      setMessage('CSV yedek indirildi.')
    } catch (csvError) {
      setError(csvError instanceof Error ? csvError.message : 'CSV yedek alınamadı.')
    } finally {
      setCsvExporting(false)
    }
  }

  function handleRestoreFile(event: ChangeEvent<HTMLInputElement>) {
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

  async function handleRestore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!restoreParsed) return
    if (!user) {
      setError('Oturum bulunamadı.')
      return
    }
    const normalizedConfirm = restoreConfirm.trim().toLocaleUpperCase('tr-TR')
    if (normalizedConfirm !== 'YÜKLE' && normalizedConfirm !== 'YUKLE') {
      setError('Geri yüklemek için onay alanına YÜKLE yazmalısın.')
      return
    }

    setRestoring(true)
    setError('')
    setMessage('')

    try {
      setRestoreStep('Mevcut veri yedekleniyor')
      const { payload } = await buildBackupPayload()
      downloadBackupFile(payload, 'financeproject-restore-oncesi')

      await restoreBackup(restoreParsed, user.id, (progress) => setRestoreStep(progress.step))

      setRestoreParsed(null)
      setRestoreConfirm('')
      setMessage(`Yedek geri yüklendi (${restoreParsed.totalRows} kayıt).`)
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? `${restoreError.message} - İşlem yarıda kaldıysa az önce inen "restore-oncesi" dosyasıyla tekrar geri yükleyebilirsin.`
          : 'Geri yükleme başarısız.',
      )
    } finally {
      setRestoring(false)
      setRestoreStep('')
    }
  }

  async function handleResetAllData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedConfirm = resetConfirm.trim().toLocaleUpperCase('tr-TR')
    if (normalizedConfirm !== 'SİL' && normalizedConfirm !== 'SIL') {
      setError('Tüm veriyi silmek için onay alanına SİL yazmalısın.')
      return
    }

    setResetting(true)
    setError('')
    setMessage('')

    try {
      const { payload, totalRows } = await buildBackupPayload()
      downloadBackupFile(payload, 'financeproject-sifirlama-oncesi')

      const resetError = await resetUserFinanceData()
      if (!resetError.ok) {
        setError(
          isMissingSupabaseCapabilityError(resetError.error)
            ? missingSupabaseCapabilityMessage('Sıfırlama altyapısı', resetError.error)
            : resetError.error.message ?? 'Tüm veri silinemedi.',
        )
        return
      }

      setResetConfirm('')
      setResetOpen(false)
      setMessage(`Tüm finans verisi silindi. Sıfırlama öncesi JSON yedek indirildi (${totalRows} kayıt).`)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Sıfırlama öncesi yedek alınamadı. Veri silinmedi.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
      <section className="space-y-4">
        <SurfaceCard variant="elevated" className="overflow-hidden">
          <div className="pointer-events-none -mt-4 mb-1 h-[2px] bg-gradient-to-r from-success via-info to-destructive opacity-80" />
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings size={20} className="text-primary" />
              Yedek ve ayarlar
            </CardTitle>
            <p className="text-sm text-muted-foreground">Yedek, geri yükleme, bildirim ve sıfırlama işlemleri.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 min-[640px]:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleFullExport()}
                disabled={exporting || resetting || restoring}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-success/25 bg-success/8 px-3 py-2.5 text-sm font-semibold text-success transition hover:bg-success/12 disabled:opacity-50"
              >
                <Download size={15} />
                {exporting ? 'Yedek alınıyor...' : 'JSON yedek'}
              </button>
              <button
                type="button"
                onClick={() => restoreFileRef.current?.click()}
                disabled={exporting || resetting || restoring}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-info/25 bg-info/8 px-3 py-2.5 text-sm font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
              >
                <Upload size={15} />
                Yedekten geri yükle
              </button>
              <input ref={restoreFileRef} type="file" accept="application/json,.json" onChange={handleRestoreFile} className="hidden" aria-label="Geri yüklenecek yedek dosyasını seç" />
              <button
                type="button"
                onClick={() => void handleCsvExport()}
                disabled={csvExporting || resetting || restoring}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                <Download size={15} />
                {csvExporting ? 'CSV hazırlanıyor...' : 'CSV yedek'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetConfirm('')
                  setResetOpen(true)
                }}
                disabled={exporting || csvExporting || resetting || restoring}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm font-semibold text-destructive transition hover:bg-destructive/12 disabled:opacity-50"
              >
                <DatabaseZap size={15} />
                Tüm veriyi sil
              </button>
            </div>
            {message ? <Alert variant="success">{message}</Alert> : null}
            {error ? <Alert variant="destructive">{error}</Alert> : null}
          </CardContent>
        </SurfaceCard>

        <NotificationSettings />
      </section>

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
