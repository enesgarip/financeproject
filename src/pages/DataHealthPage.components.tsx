import { Activity, AlertTriangle, DatabaseZap, Trash2, Upload, Wrench } from 'lucide-react'
import { Link } from 'react-router'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent } from '../components/ui/card'
import { BACKUP_TABLE_LABELS, type ParsedBackup } from '../utils/backup'
import type { HealthIssue } from './DataHealth.logic'
import {
  buildIssueGuide,
  issuePreviewDetails,
  navigationAction,
  severityClass,
} from './DataHealth.guide'
import { resolveHealthIssue, type HealthResolutionMode } from './DataHealth.resolution'
import { MAX_SAFE_REPAIR_BATCH_SIZE } from './DataHealthPage.actions'

const resolutionBadge: Record<HealthResolutionMode, { label: string; variant: 'success' | 'info' | 'warning' | 'outline' }> = {
  auto_recompute: { label: 'Otomatik güvenli', variant: 'success' },
  guarded_one_click: { label: 'Korumalı tek tık', variant: 'info' },
  guided_domain_action: { label: 'Yönlendirmeli çözüm', variant: 'info' },
  manual_reconciliation: { label: 'Mutabakat aksiyonu', variant: 'warning' },
  informational: { label: 'İnceleme aksiyonu', variant: 'outline' },
}

export function HealthStat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'danger' | 'warning' | 'info' }) {
  // Sıfır sayaç olumlu bir durum: "0 kritik" kırmızı yanıp göze batmasın —
  // renk yalnızca gerçekten kayıt varken (value > 0) anlam taşır.
  const toneClass =
    value === 0 ? 'text-ink-muted' :
    tone === 'danger' ? 'text-destructive' :
    tone === 'warning' ? 'text-warning' :
    tone === 'info' ? 'text-info' :
    'text-ink'
  return (
    <div className="min-w-0 rounded-xl border border-line-strong bg-page px-3 py-2.5">
      <p className="finance-label truncate">{label}</p>
      <p className={`finance-value mt-1 truncate text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

export function HealthIssueCard({
  issue,
  fixingId,
  undoing,
  onFix,
  onPayIssue,
  onReviewIssue,
  onSnooze,
  onDismiss,
}: {
  issue: HealthIssue
  fixingId: string | null
  undoing: boolean
  onFix: (issue: HealthIssue) => void
  onPayIssue?: (issue: HealthIssue) => void
  onReviewIssue?: (issue: HealthIssue) => void
  onSnooze: (issueId: string) => void
  onDismiss?: (issueId: string) => void
}) {
  const guide = buildIssueGuide(issue)
  const quickLink = navigationAction(issue)
  const resolution = resolveHealthIssue(issue)
  const badge = resolutionBadge[resolution.mode]
  const canFix = resolution.primaryAction === 'fix'
  const previewRows = canFix ? issuePreviewDetails(issue) : []
  const hasCardExpenseReview = Boolean(onReviewIssue)
    && (issue.kind === 'duplicateTransactionCandidate' || issue.kind === 'cardExpenseDataQuality')

  return (
    <SurfaceCard variant="default">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${severityClass(issue.severity)}`}>
            {canFix ? <Wrench size={19} /> : issue.severity === 'info' ? <Activity size={19} /> : <AlertTriangle size={19} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{issue.area}</Badge>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <h2 className="mt-2 text-base font-bold text-ink">{issue.title}</h2>
            <p className="mt-1 text-sm text-ink-muted">{issue.description}</p>
            <div className="mt-3 grid gap-2 rounded-xl border border-line-strong bg-page p-3 text-sm">
              <div>
                <p className="font-semibold text-ink">Sorun nedir?</p>
                <p className="mt-1 text-ink-muted">{guide.problem}</p>
              </div>
              <div>
                <p className="font-semibold text-ink">Neden önemli?</p>
                <p className="mt-1 text-ink-muted">{guide.whyItMatters}</p>
              </div>
              <div>
                <p className="font-semibold text-ink">Ne yapmalıyım?</p>
                <p className="mt-1 text-ink-muted">{guide.nextStep}</p>
              </div>
            </div>
            <div className="mt-3 grid gap-1 text-xs text-ink-muted">
              {/* Detay METNİ key olamaz: iki özdeş satır (aynı tutarlı iki kayıt)
                  çakışır ve biri kaybolur → index'li kararlı key. */}
              {issue.details.map((detail, index) => (
                <span key={`${issue.id}-detail-${index}`}>{detail}</span>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-primary/15 bg-primary/5 p-3 text-xs text-ink-muted">
              <p className="font-bold text-ink">{resolution.title}</p>
              <p className="mt-1">Kaynak gerçek: {resolution.sourceOfTruth}</p>
            </div>
            {previewRows.length > 0 ? (
              <div className="mt-3 rounded-xl border border-success/20 bg-success/8 p-3 text-xs text-success">
                <p className="font-bold">Düzeltme önizlemesi</p>
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
                {canFix ? (
                  <button
                    type="button"
                    onClick={() => onFix(issue)}
                    disabled={Boolean(fixingId) || undoing}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
                  >
                    {fixingId === issue.id ? 'Düzeltiliyor...' : resolution.label}
                  </button>
                ) : null}
                {resolution.primaryAction === 'payment' && onPayIssue ? (
                  <button
                    type="button"
                    onClick={() => onPayIssue(issue)}
                    disabled={Boolean(fixingId) || undoing}
                    className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-success-foreground transition hover:bg-success/90 disabled:opacity-50"
                  >
                    {resolution.label}
                  </button>
                ) : null}
                {hasCardExpenseReview && onReviewIssue ? (
                  <button
                    type="button"
                    onClick={() => onReviewIssue(issue)}
                    disabled={Boolean(fixingId) || undoing}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                  >
                    {resolution.label}
                  </button>
                ) : null}
                <Link
                  to={quickLink.to}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    (resolution.primaryAction === 'navigate' || resolution.primaryAction === 'review')
                      && !hasCardExpenseReview
                      ? 'border-primary/25 bg-primary/8 text-primary hover:bg-primary/12'
                      : 'border-line-strong bg-raised text-ink hover:bg-black/[.03] dark:hover:bg-white/[.04]'
                  }`}
                >
                  {hasCardExpenseReview
                    ? 'Kart işlemleri ekranını aç'
                    : (resolution.primaryAction === 'navigate' || resolution.primaryAction === 'review')
                    && !hasCardExpenseReview
                    ? resolution.label
                    : quickLink.label}
                </Link>
                {/* İki aksiyonun KALICILIĞI farklı: gizleme yalnız bu görünüm
                    boyunca (sayfadan çıkınca geri gelir), kapatma ise hesap
                    genelinde kalıcı. Eski "Daha sonra hatırlat" etiketi kalıcılık
                    ima ediyordu; artık ikisi de ne olduğunu söylüyor. */}
                <button
                  type="button"
                  onClick={() => onSnooze(issue.id)}
                  disabled={Boolean(fixingId) || undoing}
                  title="Yalnız bu görünümde gizlenir; sayfayı yeniden açtığında geri gelir."
                  className="rounded-lg border border-info/25 bg-info/8 px-3 py-2 text-xs font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
                >
                  Bu görünümde gizle
                </button>
                {onDismiss ? (
                  <button
                    type="button"
                    onClick={() => onDismiss(issue.id)}
                    disabled={Boolean(fixingId) || undoing}
                    title="Kalıcı: bu bulgu hesabındaki tüm cihazlarda kapalı kalır."
                    className="rounded-lg border border-line-strong bg-page px-3 py-2 text-xs font-semibold text-ink-muted transition hover:bg-black/[.03] dark:hover:bg-white/[.04] disabled:opacity-50"
                  >
                    Bu doğru, kalıcı kapat
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] text-ink-muted">
                “Bu görünümde gizle” geçicidir (sayfayı yeniden açınca geri gelir); “Bu doğru, kalıcı kapat” hesabındaki tüm cihazlarda kalıcıdır.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </SurfaceCard>
  )
}

export function FixAllModal({
  open,
  onClose,
  safeIssues,
  repairCount,
  remainingRepairCount = 0,
  fixingId,
  undoing,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  safeIssues: HealthIssue[]
  repairCount: number
  remainingRepairCount?: number
  fixingId: string | null
  undoing: boolean
  onConfirm: () => void
}) {
  return (
    <SimpleModal title="Toplu düzeltmeyi onayla" open={open} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-warning/20 bg-warning/8 p-3 text-sm text-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">{repairCount} deterministik çözüm yeniden doğrulanacak.</p>
              <p className="mt-1">
                Sunucu tüm hedefleri önce kilit altında kontrol eder. Bir kayıt önizlemeden sonra değiştiyse finans verisine hiç dokunulmaz; sonuç kalıcı denetim fişine yazılır.
              </p>
              {remainingRepairCount > 0 ? (
                <p className="mt-2 font-semibold">
                  Bu tur en fazla {MAX_SAFE_REPAIR_BATCH_SIZE} çözüm tek bir atomik veritabanı işlemi içinde uygulanır. Kalan {remainingRepairCount} çözüm, bu tur tamamlandıktan sonra güncel veriden yeniden önizlenir.
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-line-strong bg-page p-3">
          <p className="text-xs font-bold uppercase text-ink-muted">Uygulanacak güvenli çözümler</p>
          <div className="mt-2 grid gap-2">
            {safeIssues.map((issue) => {
              const resolution = resolveHealthIssue(issue)
              const previews = issuePreviewDetails(issue)
              return (
              <div key={issue.id} className="rounded-lg bg-raised px-3 py-2 text-sm ring-1 ring-line-strong">
                <p className="font-semibold text-ink">{issue.title}</p>
                <p className="mt-0.5 text-xs font-semibold text-success">{resolution.label}</p>
                <p className="mt-1 text-xs text-ink-muted">Kaynak: {resolution.sourceOfTruth}</p>
                {previews.length > 0 ? (
                  <div className="mt-1 grid gap-0.5 text-xs text-ink-muted">
                    {previews.map((preview, index) => <span key={`${issue.id}-${index}`}>{preview}</span>)}
                  </div>
                ) : null}
              </div>
              )
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={Boolean(fixingId) || undoing || repairCount === 0}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
        >
          <Wrench size={16} />
          {fixingId === 'all' ? 'Düzeltiliyor...' : 'Güvenli çözümleri uygula'}
        </button>
      </div>
    </SimpleModal>
  )
}

export function ResetDataModal({
  open,
  onClose,
  resetConfirm,
  onResetConfirmChange,
  resetting,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  resetConfirm: string
  onResetConfirmChange: (value: string) => void
  resetting: boolean
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <SimpleModal title="Tüm veriyi sil" open={open} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-destructive">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-bold">Bu işlem geri alınamaz.</p>
              <p className="mt-1">
                Varlıklar, kartlar, harcamalar, ekstre arşivi, krediler, borç/alacaklar, ödemeler, bütçeler, hedefler,
                maaş geçmişi ve işlem geçmişi silinir.
              </p>
              <p className="mt-2">
                Silme başlamadan önce tam JSON yedek otomatik indirilir; yedek alınamazsa işlem durur.
              </p>
            </div>
          </div>
        </div>
        <label className="block text-sm font-semibold text-ink">
          Onay için SİL yaz
          <input
            value={resetConfirm}
            onChange={(event) => onResetConfirmChange(event.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-line-strong bg-raised px-3 text-sm text-ink outline-none transition-all focus:border-destructive focus:ring-2 focus:ring-destructive/20 dark:bg-raised"
          />
        </label>
        <button
          type="submit"
          disabled={resetting}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90 active:scale-[0.99] disabled:opacity-50"
        >
          <DatabaseZap size={16} />
          {resetting ? 'Siliniyor...' : 'Tüm veriyi kalıcı olarak sil'}
        </button>
      </form>
    </SimpleModal>
  )
}

export function RestoreBackupModal({
  restoreParsed,
  restoring,
  restoreConfirm,
  onRestoreConfirmChange,
  restoreStep,
  onClose,
  onSubmit,
}: {
  restoreParsed: ParsedBackup | null
  restoring: boolean
  restoreConfirm: string
  onRestoreConfirmChange: (value: string) => void
  restoreStep: string
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <SimpleModal title="Yedekten geri yükle" open={restoreParsed !== null} onClose={onClose}>
      {restoreParsed ? (
        <form onSubmit={onSubmit} className="space-y-4">
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
          <div className="rounded-xl border border-line-strong bg-page p-3 text-sm">
            <p className="font-semibold text-ink">
              {restoreParsed.totalRows} kayıt geri yüklenecek
              {restoreParsed.exportedAt ? ` · Yedek tarihi: ${restoreParsed.exportedAt.slice(0, 10)}` : ''}
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
              {restoreParsed.counts.map(({ table, rows }) => (
                <li key={table}>{BACKUP_TABLE_LABELS[table]}: <span className="font-semibold tabular-nums">{rows}</span></li>
              ))}
            </ul>
          </div>
          <label className="block text-sm font-semibold text-ink">
            Onay için YÜKLE yaz
            <input
              value={restoreConfirm}
              onChange={(event) => onRestoreConfirmChange(event.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-line-strong bg-raised px-3 text-sm text-ink outline-none transition-all focus:border-warning focus:ring-2 focus:ring-warning/20 dark:bg-raised"
            />
          </label>
          <button
            type="submit"
            disabled={restoring}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
          >
            <Upload size={16} />
            {restoring ? `${restoreStep || 'Geri yükleniyor'}...` : 'Yedeği geri yükle'}
          </button>
        </form>
      ) : null}
    </SimpleModal>
  )
}
