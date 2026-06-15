import { Activity, AlertTriangle, DatabaseZap, Trash2, Upload, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SimpleModal } from '../components/SimpleModal'
import { Badge } from '../components/ui/badge'
import { Card as SurfaceCard, CardContent } from '../components/ui/card'
import { BACKUP_TABLE_LABELS, type ParsedBackup } from '../utils/backup'
import {
  buildIssueGuide,
  issuePreviewDetails,
  navigationAction,
  severityClass,
  type HealthIssue,
} from './DataHealth.logic'

export function HealthStat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'danger' | 'warning' | 'info' }) {
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

export function HealthIssueCard({
  issue,
  fixingId,
  undoing,
  onFix,
  onSnooze,
}: {
  issue: HealthIssue
  fixingId: string | null
  undoing: boolean
  onFix: (issue: HealthIssue) => void
  onSnooze: (issueId: string) => void
}) {
  const guide = buildIssueGuide(issue)
  const quickLink = navigationAction(issue)
  const previewRows = issuePreviewDetails(issue)

  return (
    <SurfaceCard variant="default">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`grid size-10 shrink-0 place-items-center rounded-xl ${severityClass(issue.severity)}`}>
            {issue.fixable ? <Wrench size={19} /> : issue.severity === 'info' ? <Activity size={19} /> : <AlertTriangle size={19} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{issue.area}</Badge>
              <Badge variant={issue.fixable ? 'success' : 'outline'}>{issue.fixable ? 'Hazır aksiyon var' : 'Elle inceleme gerekli'}</Badge>
            </div>
            <h2 className="mt-2 text-base font-bold text-foreground">{issue.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{issue.description}</p>
            <div className="mt-3 grid gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
              <div>
                <p className="font-semibold text-foreground">Sorun nedir?</p>
                <p className="mt-1 text-muted-foreground">{guide.problem}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Neden önemli?</p>
                <p className="mt-1 text-muted-foreground">{guide.whyItMatters}</p>
              </div>
              <div>
                <p className="font-semibold text-foreground">Ne yapmalıyım?</p>
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
                {issue.fixable ? (
                  <button
                    type="button"
                    onClick={() => onFix(issue)}
                    disabled={Boolean(fixingId) || undoing}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.97] disabled:opacity-50"
                  >
                    {fixingId === issue.id ? 'Düzeltiliyor...' : issue.fixLabel}
                  </button>
                ) : null}
                {quickLink ? (
                  <Link to={quickLink.to} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted">
                    {quickLink.label}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => onSnooze(issue.id)}
                  disabled={Boolean(fixingId) || undoing}
                  className="rounded-lg border border-info/25 bg-info/8 px-3 py-2 text-xs font-semibold text-info transition hover:bg-info/12 disabled:opacity-50"
                >
                  Daha sonra hatırlat
                </button>
              </div>
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
  fixableIssues,
  fixingId,
  undoing,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  fixableIssues: HealthIssue[]
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
          onClick={onConfirm}
          disabled={Boolean(fixingId) || undoing || fixableIssues.length === 0}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_2px_8px_color-mix(in_srgb,var(--primary)_30%,transparent)] transition hover:bg-primary/90 active:scale-[0.99] disabled:opacity-50"
        >
          <Wrench size={16} />
          {fixingId === 'all' ? 'Düzeltiliyor...' : 'Toplu düzeltmeyi uygula'}
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
        <label className="block text-sm font-semibold text-foreground">
          Onay için SİL yaz
          <input
            value={resetConfirm}
            onChange={(event) => onResetConfirmChange(event.target.value)}
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
              onChange={(event) => onRestoreConfirmChange(event.target.value)}
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
  )
}
