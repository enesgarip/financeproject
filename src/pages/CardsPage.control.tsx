import { FileText, ScanSearch, ShieldCheck } from 'lucide-react'
import { BankLogo } from '../components/finance/BankLogo'
import { FinancePanel, MiniStat, ProgressStrip, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import type {
  AccountReconciliation,
  Card,
  CardInstallment,
  CardStatementArchive,
} from '../types/database'
import type { CardStatementPayment } from '../types/database'
import { buildCardControlItems, type CardBankReconciliationStatus } from '../utils/cardControlCenter'
import { buildLimitGroupSummaries } from './CardsPage.helpers'
import { ConfidenceBadge } from '../components/ui/confidence-badge'
import { daysUntil, formatDate } from '../utils/date'
import { freshnessConfidence } from '../utils/dataConfidence'
import { STALE_AFTER_DAYS } from '../utils/reconciliation'
import { cardProvisionAmount } from '../utils/financeSummary'
import { formatCurrency } from '../utils/formatCurrency'
import { diffTL, sumTL } from '../utils/money'

const statusPresentation: Record<CardBankReconciliationStatus, { label: string; tone: 'good' | 'warning' | 'danger' | 'neutral' }> = {
  matched: { label: 'Bankayla mutabık', tone: 'good' },
  drift: { label: 'Fark var', tone: 'danger' },
  stale: { label: 'Kontrol zamanı', tone: 'warning' },
  never: { label: 'Henüz kontrol edilmedi', tone: 'neutral' },
}

type CardControlCenterProps = {
  rows: Card[]
  statements: CardStatementArchive[]
  /** Kısmi ekstre ödemeleri (K7): açık ekstre rakamı kalanı gösterir. */
  statementPayments?: CardStatementPayment[]
  installments: CardInstallment[]
  reconciliations: AccountReconciliation[]
  onReconcile: (card: Card) => void
  onImportStatement: (card: Card) => void
  formatAmount?: (value: number | null | undefined) => string
}

export function CardControlCenter({
  rows,
  statements,
  statementPayments = [],
  installments,
  reconciliations,
  onReconcile,
  onImportStatement,
  formatAmount = formatCurrency,
}: CardControlCenterProps) {
  const items = buildCardControlItems(rows, statements, installments, reconciliations, new Date(), statementPayments)
  if (items.length === 0) return null

  // Kart listesindeki visibleOpenStatementAmount ile aynı kural: açık arşiv
  // toplamı; hiç açık arşiv yoksa karttaki ekstre borcuna düşülür.
  const visibleStatementAmount = ({ card, openStatementAmount }: (typeof items)[number]) =>
    openStatementAmount > 0 ? openStatementAmount : card.statement_debt_amount
  const totalStatement = sumTL(items.map(visibleStatementAmount))
  const totalCurrent = sumTL(items.map(({ card }) => card.current_period_spending))
  const totalProvision = sumTL(items.map(({ card }) => cardProvisionAmount(card)))
  const totalScheduled = sumTL(items.map(({ scheduledInstallmentTotal }) => scheduledInstallmentTotal))
  const attentionCount = items.filter(({ reconciliationStatus }) => reconciliationStatus !== 'matched').length

  // Limit kullanımı: paylaşımlı limit gruplarını doğru topla (kart başına toplama çift saymaz).
  const limitGroups = buildLimitGroupSummaries(rows)
  const totalLimit = sumTL(limitGroups.map((group) => group.limit))
  const totalGroupDebt = sumTL(limitGroups.map((group) => group.debt))
  const totalAvailable = Math.max(0, diffTL(totalLimit, totalGroupDebt))
  const usageRate = totalLimit > 0 ? Math.min(100, (totalGroupDebt / totalLimit) * 100) : 0

  return (
    <FinancePanel tone={attentionCount > 0 ? 'warning' : 'premium'} className="p-4 sm:p-5">
      <SectionHeader
        title="Kart kontrol merkezi"
        description="Kart harcaması, ekstre, gelecek taksit ve banka mutabakatı aynı yerde."
        action={
          <StatusBadge tone={attentionCount > 0 ? 'warning' : 'good'}>
            {attentionCount > 0 ? `${attentionCount} kart kontrol bekliyor` : 'Tümü güncel'}
          </StatusBadge>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 min-[620px]:grid-cols-4">
        <MiniStat label="Açık ekstre" value={formatAmount(totalStatement)} tone={totalStatement > 0 ? 'warning' : 'good'} />
        <MiniStat label="Dönem içi harcama" value={formatAmount(totalCurrent)} tone="info" />
        <MiniStat label="Provizyon" value={formatAmount(totalProvision)} tone={totalProvision > 0 ? 'warning' : 'neutral'} />
        <MiniStat label="Gelecek taksit" value={formatAmount(totalScheduled)} tone={totalScheduled > 0 ? 'warning' : 'neutral'} />
      </div>

      {totalLimit > 0 ? (
        <div className="mt-4">
          <ProgressStrip
            label="Limit kullanımı"
            value={usageRate}
            tone={usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'}
          />
          <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums text-ink-muted">
            <span>Kalan {formatAmount(totalAvailable)}</span>
            <span>Limit {formatAmount(totalLimit)}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {items.map((item) => {
          const { card, latestReconciliation, openStatementDueDate, reconciliationStatus, scheduledInstallmentTotal } = item
          const statementAmount = visibleStatementAmount(item)
          const status = statusPresentation[reconciliationStatus]
          const drift = latestReconciliation
            ? diffTL(latestReconciliation.app_amount, latestReconciliation.real_amount)
            : null
          // Borç rakamı kesin görünür ama uzun süredir bankayla karşılaştırılmadıysa
          // güvenilirliği düşer; aynı görsel dil kur/tahmin rozetleriyle paylaşılır.
          const daysSinceCheck = latestReconciliation
            ? -(daysUntil(latestReconciliation.reconciled_at.slice(0, 10)) ?? 0)
            : null
          const confidence = freshnessConfidence(daysSinceCheck, STALE_AFTER_DAYS, 'Bu kartın borcu')

          return (
            <article key={card.id} className="rounded-xl bg-raised p-3 ring-1 ring-line-strong">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <BankLogo bankName={card.bank_name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-ink">{card.card_name}</p>
                    <p className="truncate text-xs text-ink-muted">{card.bank_name}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <ConfidenceBadge confidence={confidence} />
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 min-[620px]:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                <MiniStat
                  label="Ekstre"
                  value={formatAmount(statementAmount)}
                  tone={statementAmount > 0 ? 'warning' : 'good'}
                />
                <MiniStat label="Dönem içi" value={formatAmount(card.current_period_spending)} tone="info" />
                <MiniStat label="Provizyon" value={formatAmount(cardProvisionAmount(card))} />
                <MiniStat label="Gelecek taksit" value={formatAmount(scheduledInstallmentTotal)} />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-page px-3 py-2 text-xs">
                <div className="flex min-w-0 items-start gap-2">
                  <ShieldCheck size={14} className={reconciliationStatus === 'matched' ? 'mt-0.5 shrink-0 text-success' : 'mt-0.5 shrink-0 text-warning'} />
                  <p className="min-w-0 text-ink-muted">
                    {latestReconciliation ? (
                      <>
                        Son banka kontrolü {formatDate(latestReconciliation.reconciled_at.slice(0, 10))}
                        {drift !== null && reconciliationStatus === 'drift'
                          ? ` · Uygulama − banka farkı ${drift > 0 ? '+' : ''}${formatAmount(drift)}`
                          : ''}
                        {/* Faz D1'den beri düzeltilen fark kayıtta duruyor; "sorunsuz geçti"
                            ile "fark çıktı ama kapatıldı" artık ayırt edilebilir. */}
                        {latestReconciliation.resolution === 'corrected' && drift !== null
                          ? ` · ${formatAmount(Math.abs(drift))} fark düzeltildi`
                          : ''}
                      </>
                    ) : (
                      'Bankadaki gerçek borç henüz kaydedilmedi.'
                    )}
                  </p>
                </div>
                {openStatementDueDate ? (
                  <span className="shrink-0 font-bold text-ink">Son ödeme {formatDate(openStatementDueDate)}</span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onImportStatement(card)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-xs font-bold text-ink transition hover:bg-black/[.03] dark:hover:bg-white/[.04]"
                >
                  <FileText size={14} />
                  Ekstre aktar
                </button>
                <button
                  type="button"
                  onClick={() => onReconcile(card)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:bg-primary/90"
                >
                  <ScanSearch size={14} />
                  Mutabakat
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </FinancePanel>
  )
}
