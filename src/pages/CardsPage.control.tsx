import { FileText, ScanSearch, ShieldCheck } from 'lucide-react'
import { BankLogo } from '../components/finance/BankLogo'
import { FinancePanel, MiniStat, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import type {
  AccountReconciliation,
  Card,
  CardInstallment,
  CardStatementArchive,
} from '../types/database'
import { buildCardControlItems, type CardBankReconciliationStatus } from '../utils/cardControlCenter'
import { formatDate } from '../utils/date'
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
  installments: CardInstallment[]
  reconciliations: AccountReconciliation[]
  onReconcile: (card: Card) => void
  onImportStatement: (card: Card) => void
  formatAmount?: (value: number | null | undefined) => string
}

export function CardControlCenter({
  rows,
  statements,
  installments,
  reconciliations,
  onReconcile,
  onImportStatement,
  formatAmount = formatCurrency,
}: CardControlCenterProps) {
  const items = buildCardControlItems(rows, statements, installments, reconciliations)
  if (items.length === 0) return null

  const totalStatement = sumTL(items.map(({ card }) => card.statement_debt_amount))
  const totalCurrent = sumTL(items.map(({ card }) => card.current_period_spending))
  const totalProvision = sumTL(items.map(({ card }) => cardProvisionAmount(card)))
  const totalScheduled = sumTL(items.map(({ scheduledInstallmentTotal }) => scheduledInstallmentTotal))
  const attentionCount = items.filter(({ reconciliationStatus }) => reconciliationStatus !== 'matched').length

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

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {items.map(({ card, latestReconciliation, openStatement, reconciliationStatus, scheduledInstallmentTotal }) => {
          const status = statusPresentation[reconciliationStatus]
          const drift = latestReconciliation
            ? diffTL(latestReconciliation.app_amount, latestReconciliation.real_amount)
            : null

          return (
            <article key={card.id} className="rounded-xl bg-card/85 p-3 ring-1 ring-border/75">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <BankLogo bankName={card.bank_name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-foreground">{card.card_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{card.bank_name}</p>
                  </div>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 min-[620px]:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
                <MiniStat
                  label="Ekstre"
                  value={formatAmount(openStatement?.statement_debt_amount ?? card.statement_debt_amount)}
                  tone={card.statement_debt_amount > 0 ? 'warning' : 'good'}
                />
                <MiniStat label="Dönem içi" value={formatAmount(card.current_period_spending)} tone="info" />
                <MiniStat label="Provizyon" value={formatAmount(cardProvisionAmount(card))} />
                <MiniStat label="Gelecek taksit" value={formatAmount(scheduledInstallmentTotal)} />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <div className="flex min-w-0 items-start gap-2">
                  <ShieldCheck size={14} className={reconciliationStatus === 'matched' ? 'mt-0.5 shrink-0 text-success' : 'mt-0.5 shrink-0 text-warning'} />
                  <p className="min-w-0 text-muted-foreground">
                    {latestReconciliation ? (
                      <>
                        Son banka kontrolü {formatDate(latestReconciliation.reconciled_at.slice(0, 10))}
                        {drift !== null && reconciliationStatus === 'drift'
                          ? ` · App − banka farkı ${drift > 0 ? '+' : ''}${formatAmount(drift)}`
                          : ''}
                      </>
                    ) : (
                      'Bankadaki gerçek borç henüz kaydedilmedi.'
                    )}
                  </p>
                </div>
                {openStatement?.due_date ? (
                  <span className="shrink-0 font-bold text-foreground">Son ödeme {formatDate(openStatement.due_date)}</span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onImportStatement(card)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground transition hover:bg-muted"
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
                  Hareket PDF&apos;i
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </FinancePanel>
  )
}
