import { AlertTriangle, ArrowRightLeft, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { BankLogo } from '../components/finance/BankLogo'
import { AccountLedgerPanel } from '../components/finance/AccountLedgerPanel'
import { CardLedgerPanel } from '../components/finance/CardLedgerPanel'
import { MiniStat, SectionHeader, StatusBadge } from '../components/finance/FinanceUI'
import type { Card, CardInstallment, CardStatementArchive } from '../types/database'
import { nextMonthlyDate } from '../utils/date'
import { cardPayableDebt } from '../utils/financeSummary'
import { bankBrandGradient, getBankBrand } from '../utils/bankBranding'
import {
  activeInstallmentCount,
  bankHueStyle,
  formatMonthLabel,
  formatMonthlyDay,
  formatShortDate,
  getCreditCardStatus,
  limitGroupStats,
  statementPeriodLabel,
  visibleOpenStatementAmount,
} from './CardsPage.helpers'
import { CardDatum } from './CardsPage.overview'
import { formatCurrency } from '../utils/formatCurrency'

export function CreditAccountListCard({
  row,
  rows,
  statements,
  installments,
  menu,
  rowActions,
  onTransfer,
  onAddExpense,
  onImportStatement,
  onImportMovements,
  onChanged,
}: {
  row: Card
  rows: Card[]
  statements: CardStatementArchive[]
  installments: CardInstallment[]
  menu: React.ReactNode
  rowActions: React.ReactNode
  onTransfer: (source: Card) => void
  onAddExpense: (card: Card, mode: 'cash' | 'installment') => void
  onImportStatement: (card: Card) => void
  onImportMovements: (card: Card) => void
  onChanged?: () => void | Promise<void>
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  if (row.card_type === 'banka_karti') {
    const accountCount = rows.filter((card) => card.card_type === 'banka_karti').length

    return (
      <article
        style={bankHueStyle(row.bank_name, rows)}
        className="finance-panel min-w-0 rounded-lg p-4 ring-1 ring-[hsl(var(--bank-hue)_42%_82%/0.55)] dark:ring-[hsl(var(--bank-hue)_40%_42%/0.45)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BankLogo bankName={row.bank_name} size="md" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-foreground">{row.card_name}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">{row.bank_name} · banka hesabı</p>
            </div>
          </div>
          {menu}
        </div>

        <div className="mt-4 rounded-lg bg-[hsl(var(--bank-hue)_58%_97%)] p-3 ring-1 ring-[hsl(var(--bank-hue)_50%_84%/0.7)] dark:bg-[hsl(var(--bank-hue)_40%_16%)] dark:ring-[hsl(var(--bank-hue)_36%_34%)]">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">Kullanılabilir bakiye</p>
          <p className="finance-value mt-1 truncate text-[clamp(1.35rem,6vw,2rem)] font-black leading-none text-foreground">
            {formatCurrency(row.current_balance)}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <CardDatum label="Tür" value="Banka hesabı" />
          <CardDatum label="Not" value={row.note || '-'} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTransfer(row)}
            disabled={accountCount < 2}
            className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-black text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-55"
          >
            <ArrowRightLeft size={15} />
            Transfer yap
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen((current) => !current)}
            aria-expanded={detailsOpen}
            className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
          >
            Hareketler
          </button>
        </div>
        {detailsOpen ? <AccountLedgerPanel card={row} onChanged={onChanged} /> : null}
        {rowActions}
      </article>
    )
  }

  const stats = limitGroupStats(row, rows)
  const usageRate = Math.round(stats.usageRate)
  const dueDate = nextMonthlyDate(row.due_day)
  const status = getCreditCardStatus(row, stats.usageRate)
  const displayedOpenStatementAmount = visibleOpenStatementAmount(row, statements)
  const installmentCount = activeInstallmentCount(row, installments)
  const payableDebt = cardPayableDebt(row)
  const openStatements = statements.filter((statement) => statement.card_id === row.id && statement.status === 'open')
  const cardInstallments = installments
    .filter((installment) => installment.card_id === row.id && installment.status !== 'paid')
    .sort((left, right) => left.due_month.localeCompare(right.due_month))

  return (
    <article
      style={bankHueStyle(row.bank_name, rows)}
      className="finance-panel min-w-0 rounded-lg bg-card/96 p-4 ring-1 ring-[hsl(var(--bank-hue)_42%_82%/0.55)] dark:ring-[hsl(var(--bank-hue)_40%_42%/0.45)]"
    >
      <div
        style={{ backgroundImage: bankBrandGradient(row.bank_name) }}
        className="relative rounded-lg p-4 text-white shadow-sm"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
          <div className="absolute inset-x-0 top-0 h-px bg-white/35" />
          <div className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-2xl" />
        </div>
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold uppercase text-white/70">{row.bank_name}</p>
            <h2 className="mt-1 truncate text-lg font-black leading-tight">{row.card_name}</h2>
            {row.holder_name ? <p className="mt-1 truncate text-xs font-semibold text-white/70">{row.holder_name}</p> : null}
          </div>
          <div className="flex shrink-0 items-start gap-2">
            <div className="grid size-10 place-items-center rounded-lg bg-white/15 text-xs font-black uppercase tracking-tight text-white ring-1 ring-white/25">
              {getBankBrand(row.bank_name).code}
            </div>
            <div className="[&>div>button]:border-white/30 [&>div>button]:bg-white/15 [&>div>button]:text-white [&>div>button:hover]:bg-white/25 [&>div>button:hover]:text-white">
              {menu}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase text-white/65">Güncel borç</p>
            <p className="finance-value mt-1 truncate text-[clamp(1.45rem,6vw,2.15rem)] font-black leading-none">{formatCurrency(row.debt_amount)}</p>
          </div>
          <span className="rounded-lg bg-white/14 px-2.5 py-1 text-xs font-black ring-1 ring-white/18">%{usageRate}</span>
        </div>

        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-white/18">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${stats.usageRate}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-white/72">
            <span>Limit {formatCurrency(stats.sharedLimit)}</span>
            <span>Kalan {formatCurrency(stats.availableLimit)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex min-h-6 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-black ring-1 ${status.className}`}>
          {status.label === 'Normal' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {status.label}
        </span>
        <span className="rounded-lg bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{status.description}</span>
        {stats.isShared ? <span className="rounded-lg bg-info/10 px-2.5 py-1 text-xs font-bold text-info">Ortak limit</span> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <CardDatum label="Kullanılabilir" value={formatCurrency(stats.availableLimit)} tone="good" />
        <CardDatum label="Dönem borcu" value={formatCurrency(row.current_period_spending)} />
        <CardDatum label="Açık ekstre" value={formatCurrency(displayedOpenStatementAmount)} tone={displayedOpenStatementAmount > 0 ? 'danger' : 'neutral'} />
        <CardDatum label="Devam eden taksit" value={`${installmentCount} işlem`} tone={installmentCount > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/55 px-3 py-2">
          <p className="font-bold uppercase text-muted-foreground">Ekstre</p>
          <p className="mt-1 font-extrabold text-foreground">{formatMonthlyDay(row.statement_day)}</p>
        </div>
        <div className="rounded-lg bg-muted/55 px-3 py-2">
          <p className="font-bold uppercase text-muted-foreground">Son ödeme</p>
          <p className="mt-1 font-extrabold text-foreground">{formatShortDate(dueDate)}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 min-[620px]:grid-cols-5">
        <button
          type="button"
          onClick={() => setDetailsOpen((current) => !current)}
          aria-expanded={detailsOpen}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Detay
        </button>
        <button
          type="button"
          onClick={() => onAddExpense(row, 'cash')}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Harcama ekle
        </button>
        <button
          type="button"
          onClick={() => onImportStatement(row)}
          className="finance-touch-target inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Ekstre içe aktar
        </button>
        <button
          type="button"
          onClick={() => onImportMovements(row)}
          className="finance-touch-target inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Mutabakat
        </button>
        <button
          type="button"
          onClick={() => onAddExpense(row, 'installment')}
          className="finance-touch-target inline-flex items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-xs font-black text-foreground shadow-sm transition hover:bg-muted"
        >
          Taksit ekle
        </button>
      </div>
      {detailsOpen ? (
        <div className="mt-4 rounded-lg border border-border/80 bg-surface-muted/70 p-3 ring-1 ring-border/60">
          <SectionHeader
            title="Kart detay özeti"
            description="Borç, ekstre, limit, vade ve devam eden taksitleri birlikte oku."
            action={<StatusBadge tone={payableDebt > 0 ? 'warning' : 'good'}>{payableDebt > 0 ? 'Açık ekstre' : 'Temiz'}</StatusBadge>}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 min-[620px]:grid-cols-3">
            <MiniStat label="Ödenebilir" value={formatCurrency(payableDebt)} tone={payableDebt > 0 ? 'warning' : 'good'} />
            <MiniStat label="Açık ekstre" value={formatCurrency(displayedOpenStatementAmount)} tone={displayedOpenStatementAmount > 0 ? 'danger' : 'neutral'} />
            <MiniStat label="Kalan limit" value={formatCurrency(stats.availableLimit)} tone="good" />
            <MiniStat label="Son ödeme" value={formatShortDate(dueDate)} tone={payableDebt > 0 ? 'warning' : 'neutral'} />
            <MiniStat label="Ekstre günü" value={formatMonthlyDay(row.statement_day)} />
            <MiniStat label="Limit kullanımı" value={`%${usageRate}`} tone={usageRate >= 80 ? 'danger' : usageRate >= 55 ? 'warning' : 'good'} />
          </div>
          <div className="mt-4 grid gap-3 min-[760px]:grid-cols-2">
            <div className="rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
              <p className="text-xs font-black uppercase text-muted-foreground">Devam eden taksitler</p>
              {cardInstallments.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {cardInstallments.slice(0, 3).map((installment) => (
                    <div key={installment.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-foreground">{installment.description}</span>
                      <span className="shrink-0 font-black tabular-nums text-foreground">
                        {formatCurrency(installment.amount)} · {formatMonthLabel(installment.due_month.slice(0, 7))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Devam eden taksit yok.</p>
              )}
            </div>
            <div className="rounded-lg bg-card/80 p-3 ring-1 ring-border/70">
              <p className="text-xs font-black uppercase text-muted-foreground">Ekstre geçmişi</p>
              {openStatements.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  {openStatements.slice(0, 3).map((statement) => (
                    <div key={statement.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/55 px-3 py-2 text-xs">
                      <span className="min-w-0 truncate font-bold text-foreground">{statementPeriodLabel(statement)}</span>
                      <span className="shrink-0 font-black tabular-nums text-foreground">{formatCurrency(statement.statement_debt_amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Açık ekstre kaydı yok.</p>
              )}
            </div>
          </div>
          <CardLedgerPanel card={row} onChanged={onChanged} />
        </div>
      ) : null}
    </article>
  )
}
